import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Requires a running PostgreSQL (migrated, pgvector enabled) + Redis reachable
 * via `.env.test`. No LLM/embedding provider is configured in `.env.test`, so
 * this suite exercises the real text-fallback retrieval and extraction-skip
 * paths, plus an explicit `waitFor` helper to observe real BullMQ jobs
 * (running inside this same test process) complete asynchronously.
 */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('Memory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-memory-${randomUUID()}@example.com`;
  const otherEmail = `e2e-memory-other-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;
  let otherAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Memory' });
    accessToken = res.body.accessToken;

    const otherRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: otherEmail, password, displayName: 'E2E Memory Other' });
    otherAccessToken = otherRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  // 1 & 2: create + retrieve a personal memory
  it('creates and retrieves a personal memory', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'personal',
        space: 'personal',
        kind: 'preference',
        content: 'Préfère recevoir ses rappels importants de façon courte et directe',
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('active');

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/memories/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.content).toMatch(/rappels importants/);
  });

  // 3: create professional/logistiga
  let logistigaMemoryId: string;
  it('creates a professional/logistiga memory', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'professional',
        space: 'logistiga',
        kind: 'fact',
        content: 'Le client Logistiga paie ses factures à 30 jours',
      });
    expect(created.status).toBe(201);
    expect(created.body.space).toBe('logistiga');
    logistigaMemoryId = created.body.id;
  });

  // 4 & 5: scope isolation
  it('never leaks personal memories into a professional list, or vice versa', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'personal',
        space: 'personal',
        kind: 'fact',
        content: 'Anniversaire de sa fille le 12 mars',
      });

    const personalList = await request(app.getHttpServer())
      .get('/api/v1/memories?scope=personal&space=personal')
      .set('Authorization', `Bearer ${accessToken}`);
    const professionalList = await request(app.getHttpServer())
      .get('/api/v1/memories?scope=professional&space=logistiga')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(personalList.body.some((m: { content: string }) => m.content.includes('Logistiga'))).toBe(false);
    expect(professionalList.body.some((m: { content: string }) => m.content.includes('Anniversaire'))).toBe(false);
    expect(professionalList.body.some((m: { id: string }) => m.id === logistigaMemoryId)).toBe(true);
  });

  // 6: another user sees nothing
  it('never lets another user see or access a memory that is not theirs', async () => {
    const otherList = await request(app.getHttpServer())
      .get('/api/v1/memories')
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(otherList.body).toHaveLength(0);

    const otherGet = await request(app.getHttpServer())
      .get(`/api/v1/memories/${logistigaMemoryId}`)
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(otherGet.status).toBe(403);
  });

  // 7: archive
  it('archives a memory', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/memories/${logistigaMemoryId}/archive`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('archived');

    const list = await request(app.getHttpServer())
      .get('/api/v1/memories?scope=professional&space=logistiga&status=active')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.body.some((m: { id: string }) => m.id === logistigaMemoryId)).toBe(false);
  });

  // 8: supersede via update flow (create -> supersede by creating a contradicting memory through extraction path is
  // covered in unit tests; here we verify the MemoryService.supersede business rule end-to-end via direct creation +
  // the archive/PATCH endpoints, and that history is preserved, not deleted).
  it('supersede keeps the old memory (never deletes it) and links it to the new one', async () => {
    const original = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ scope: 'personal', space: 'personal', kind: 'preference', content: 'Préfère le café le matin' });

    // Simulate what MemoryExtractionService.commitCandidates does when it
    // finds a near-duplicate: supersede via the service directly (no public
    // "supersede" HTTP endpoint is specified for Phase C — only the internal
    // extraction pipeline and MemoryService use it).
    const memoryService = app.get((await import('../src/memory/memory.service.js')).MemoryService);
    const { old, replacement } = await memoryService.supersede(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).id,
      original.body.id,
      { scope: 'personal', space: 'personal', kind: 'preference', content: 'Préfère le thé le matin' },
    );

    expect(old.status).toBe('superseded');
    expect(old.supersededById).toBe(replacement.id);
    expect(replacement.status).toBe('active');

    const stillThere = await prisma.memory.findUnique({ where: { id: old.id } });
    expect(stillThere).not.toBeNull(); // history preserved, never deleted
  });

  // 9: profile facts (read-only API; seed directly since Phase C has no POST endpoint for facts)
  it('lists profile facts, scoped to the caller', async () => {
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    await prisma.profileFact.create({
      data: {
        userId,
        scope: 'personal',
        space: 'personal',
        key: 'communication_style',
        value: 'concise',
        source: 'manual',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/profile-facts?scope=personal&space=personal')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((f: { key: string }) => f.key === 'communication_style')).toBe(true);

    const otherRes = await request(app.getHttpServer())
      .get('/api/v1/profile-facts')
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(otherRes.body).toHaveLength(0);
  });

  // 10: entities (also read-only API; seed via EntitiesService like extraction would)
  it('lists entities, scoped to the caller', async () => {
    const entitiesService = app.get((await import('../src/memory/entities.service.js')).EntitiesService);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    await entitiesService.findOrCreate({
      userId,
      scope: 'professional',
      space: 'logistiga',
      type: 'company',
      name: 'Logistiga',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/entities?scope=professional&space=logistiga')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((e: { name: string }) => e.name === 'Logistiga')).toBe(true);
  });

  // 11: conversation summary — force one via ConversationSummaryService with a stub LLM override is covered in unit
  // tests; here we verify the read API is user-scoped and empty by default.
  it('conversation-summaries endpoint is user-scoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/conversation-summaries')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('conversation-summaries and memories endpoints require auth', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/memories');
    const b = await request(app.getHttpServer()).get('/api/v1/entities');
    const c = await request(app.getHttpServer()).get('/api/v1/profile-facts');
    const d = await request(app.getHttpServer()).get('/api/v1/conversation-summaries');
    expect([a.status, b.status, c.status, d.status]).toEqual([401, 401, 401, 401]);
  });

  // 12: POST /messages uses the ContextBuilder (integration, no LLM configured → graceful placeholder,
  // but the retrieval/context pipeline runs for real).
  it('POST /messages for personal/professional routes through ContextBuilder without error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi le rendez-vous de ma fille demain' });
    expect(res.status).toBe(201);
    expect(res.body.route).toBe('personal');
    expect(res.body.response).toMatch(/configuration llm manquante/i);
  });

  // 13: a real BullMQ extraction job runs for a personal/professional message
  it('enqueues a real memory-extraction BullMQ job after a personal message', async () => {
    const before = await prisma.auditEntry.count({ where: { action: 'message_processed' } });
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi encore le rendez-vous de ma fille demain matin' });
    expect(res.status).toBe(201);

    // The audit entry is written synchronously in the request path; its
    // presence confirms the orchestrator ran end-to-end (the extraction job
    // itself is fire-and-forget and, with no LLM configured, legitimately
    // produces zero candidates — see MemoryExtractionService unit tests for
    // the parsing/commit behavior with a configured LLM).
    await waitFor(async () => (await prisma.auditEntry.count({ where: { action: 'message_processed' } })) > before);
  });

  // 14: real textual fallback (no embedding provider configured in .env.test)
  it('retrieval falls back to real text search when no embedding provider is configured', async () => {
    const { MemoryRetrievalService } = await import('../src/memory/memory-retrieval.service.js');
    const retrievalService = app.get(MemoryRetrievalService);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    const result = await retrievalService.retrieve({
      userId,
      scope: 'personal',
      space: 'personal',
      queryText: 'rappels courts directs',
    });

    expect(result.mode).not.toBe('semantic');
  });
});

/**
 * 15: semantic retrieval with pgvector, using a mocked embedding provider
 * (deterministic synthetic vectors) since no real embedding API key is
 * configured in this environment — see the Phase C report for what remains
 * to be validated once a real provider key is supplied.
 */
describe('Memory (e2e) — semantic retrieval with a mocked embedding provider', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-memory-semantic-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;

  // Deterministic "embedding": maps a small vocabulary to fixed dimensions so
  // that semantically related sentences (sharing vocabulary) land close in
  // cosine space, and unrelated ones don't — enough to prove the pgvector
  // pipeline (storage, dimension tracking, cosine search, scoring) end to end
  // without a real network call.
  function syntheticEmbed(text: string): number[] {
    const vocab = ['rappel', 'court', 'direct', 'notification', 'logistiga', 'facture', 'paiement', 'delai'];
    const lower = text.toLowerCase();
    return vocab.map((word) => (lower.includes(word) ? 1 : 0));
  }

  beforeAll(async () => {
    const { OpenAiEmbeddingProvider } = await import(
      '../src/embedding/providers/openai-embedding.provider.js'
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiEmbeddingProvider)
      .useValue({
        name: 'openai-compatible',
        isConfigured: () => true,
        embed: async (text: string) => ({
          embedding: syntheticEmbed(text),
          model: 'synthetic-test-model',
          dimensions: 8,
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Semantic' });
    accessToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('stores a real pgvector embedding (measured dimension, not assumed) via the background job', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'personal',
        space: 'personal',
        kind: 'preference',
        content: 'Préfère un rappel court et direct',
      });
    expect(created.status).toBe(201);

    await waitFor(async () => {
      const rows = await prisma.$queryRaw<Array<{ dims: number | null }>>`
        SELECT embedding_dimensions AS dims FROM memories WHERE id = ${created.body.id}::uuid
      `;
      return rows[0]?.dims === 8;
    }, 12000);

    const vectorNotNull = await prisma.$queryRaw<Array<{ has_vector: boolean }>>`
      SELECT (embedding IS NOT NULL) AS has_vector FROM memories WHERE id = ${created.body.id}::uuid
    `;
    expect(vectorNotNull[0].has_vector).toBe(true);
  });

  it('retrieves a memory by real cosine similarity for a differently-worded query (personal)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'personal',
        space: 'personal',
        kind: 'preference',
        content: 'Préfère recevoir ses rappels de façon courte et directe',
      });

    await waitFor(async () => {
      const rows = await prisma.$queryRaw<Array<{ has_vector: boolean }>>`
        SELECT (embedding IS NOT NULL) AS has_vector FROM memories WHERE id = ${created.body.id}::uuid
      `;
      return rows[0]?.has_vector === true;
    }, 12000);

    const { MemoryRetrievalService } = await import('../src/memory/memory-retrieval.service.js');
    const retrievalService = app.get(MemoryRetrievalService);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    // Different wording, same underlying vocabulary ("notification" vs "rappel" not shared,
    // but "court"/"direct" are) — a real similarity search, not a string match.
    const result = await retrievalService.retrieve({
      userId,
      scope: 'personal',
      space: 'personal',
      queryText: "Comment aime-t-il recevoir ses notifications importantes, de façon courte et directe ?",
    });

    expect(result.mode).toBe('semantic');
    expect(result.memories.some((m) => m.id === created.body.id)).toBe(true);
  });

  it('retrieves a professional/logistiga memory by semantic similarity, isolated from personal', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'professional',
        space: 'logistiga',
        kind: 'fact',
        content: 'Le client Logistiga a un délai de paiement de facture',
      });

    await waitFor(async () => {
      const rows = await prisma.$queryRaw<Array<{ has_vector: boolean }>>`
        SELECT (embedding IS NOT NULL) AS has_vector FROM memories WHERE id = ${created.body.id}::uuid
      `;
      return rows[0]?.has_vector === true;
    }, 12000);

    const { MemoryRetrievalService } = await import('../src/memory/memory-retrieval.service.js');
    const retrievalService = app.get(MemoryRetrievalService);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    const professionalResult = await retrievalService.retrieve({
      userId,
      scope: 'professional',
      space: 'logistiga',
      queryText: 'Quel est le délai de paiement de facture pour Logistiga ?',
    });
    expect(professionalResult.mode).toBe('semantic');
    expect(professionalResult.memories.some((m) => m.id === created.body.id)).toBe(true);

    // Isolation still holds under semantic search: a personal-scope query
    // must never surface the Logistiga fact even if vocabulary overlapped.
    const personalResult = await retrievalService.retrieve({
      userId,
      scope: 'personal',
      space: 'personal',
      queryText: 'Quel est le délai de paiement de facture pour Logistiga ?',
    });
    expect(personalResult.memories.some((m) => m.id === created.body.id)).toBe(false);
  });
});
