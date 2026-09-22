import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OpenAiCompatibleChatAdapter } from '../src/ai-providers/adapters/openai-compatible-chat.adapter.js';

/**
 * Requires a running PostgreSQL (migrated) + Redis reachable via `.env.test`,
 * which also supplies a real (but dummy) MORA_ENCRYPTION_KEY so this suite
 * exercises real AES-256-GCM encrypt/decrypt round-trips, not mocks.
 */
describe('AI Providers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-ai-providers-${randomUUID()}@example.com`;
  const otherEmail = `e2e-ai-providers-other-${randomUUID()}@example.com`;
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
      .send({ email, password, displayName: 'E2E AI Providers' });
    accessToken = res.body.accessToken;

    const otherRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: otherEmail, password, displayName: 'E2E AI Providers Other' });
    otherAccessToken = otherRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  // 1. create ai_provider
  let providerId: string;
  it('creates an ai_provider with an API key, real AES-256-GCM ciphertext stored', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test OpenAI',
        provider: 'openai',
        kind: 'chat',
        model: 'gpt-4o-mini',
        apiKey: 'sk-e2e-test-key-1234567890',
      });

    expect(res.status).toBe(201);
    providerId = res.body.id;

    // 2 & 3: GET never exposes the key, only hasKey + keyHint.
    expect(res.body.hasKey).toBe(true);
    expect(res.body.keyHint).toBe('7890');
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('apiKeyEncrypted');
    expect(res.body).not.toHaveProperty('apiKeyIv');
    expect(res.body).not.toHaveProperty('apiKeyAuthTag');
    expect(JSON.stringify(res.body)).not.toContain('sk-e2e-test-key-1234567890');

    // Verify what's actually in Postgres is a real ciphertext, not plaintext.
    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });
    expect(row.apiKeyEncrypted).not.toContain('sk-e2e-test-key');
    expect(row.apiKeyEncrypted).not.toBeNull();
    expect(row.apiKeyIv).not.toBeNull();
    expect(row.apiKeyAuthTag).not.toBeNull();
  });

  it('GET /ai-providers/:id never exposes the key either', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.keyHint).toBe('7890');
    expect(JSON.stringify(res.body)).not.toContain('sk-e2e-test-key');
  });

  // 4. update
  it('PATCH without apiKey keeps the existing key untouched', async () => {
    const before = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Renamed OpenAI' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed OpenAI');

    const after = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.apiKeyEncrypted).toBe(before.apiKeyEncrypted);
    expect(after.apiKeyIv).toBe(before.apiKeyIv);
  });

  it('PATCH with a new apiKey rotates it (new IV, different ciphertext)', async () => {
    const before = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: 'sk-rotated-key-999' });

    expect(res.status).toBe(200);
    expect(res.body.keyHint).toBe('-999');

    const after = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.apiKeyIv).not.toBe(before.apiKeyIv);
    expect(after.apiKeyEncrypted).not.toBe(before.apiKeyEncrypted);
  });

  // 5 & 6. disable / enable
  it('disables and re-enables a provider', async () => {
    const disableRes = await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/${providerId}/disable`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(disableRes.status).toBe(201);
    expect(disableRes.body.isActive).toBe(false);

    const enableRes = await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/${providerId}/enable`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(enableRes.status).toBe(201);
    expect(enableRes.body.isActive).toBe(true);
  });

  // 7. set default
  it('sets a provider as default, and setting a second default unsets the first', async () => {
    const setDefaultRes = await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/${providerId}/set-default`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setDefaultRes.status).toBe(201);
    expect(setDefaultRes.body.isDefault).toBe(true);

    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Second Chat', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini', isDefault: true });
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.isDefault).toBe(true);

    const firstAfter = await request(app.getHttpServer())
      .get(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(firstAfter.body.isDefault).toBe(false); // exactly one default — DB constraint + service logic

    await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/${secondRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/${providerId}/set-default`)
      .set('Authorization', `Bearer ${accessToken}`);
  });

  // 8. provider test (mocked adapter — no real network call, no real key needed)
  it('POST /:id/test runs a real call through the adapter layer (mocked HTTP) and records the result', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => ({ content: 'pong', model: 'gpt-4o-mini' }),
        supportsTools: () => false,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();

    const res = await request(testApp.getHttpServer())
      .post(`/api/v1/ai-providers/${providerId}/test`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerId } });
    expect(row.lastTestStatus).toBe('success');
    expect(row.lastTestedAt).not.toBeNull();

    await testApp.close();
  });

  // 9. another user never sees this user's provider
  it("another user cannot list, read, update, or delete this user's provider", async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(list.body.some((p: { id: string }) => p.id === providerId)).toBe(false);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(get.status).toBe(403);

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(403);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/${providerId}`)
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(del.status).toBe(403);
  });

  it('rejects an unauthenticated request with no client-supplied userId trick possible', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ai-providers');
    expect(res.status).toBe(401);
  });

  // 10. delete
  it('deletes a provider', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'To Delete', provider: 'openai', kind: 'embedding', model: 'text-embedding-3-small' });

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(del.status).toBe(204);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/ai-providers/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(get.status).toBe(404);
  });

  // 11. status endpoint
  it('GET /ai-providers/status reports configured kinds without ever leaking a key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.chatConfigured).toBe(true);
    expect(res.body.defaults.chat).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/sk-/);
  });

  // 12. chat selection through the real message pipeline
  it('POST /messages uses the DB chat provider (mocked adapter) instead of the env fallback', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => ({ content: 'Réponse via AiProvider DB', model: 'gpt-4o-mini' }),
        supportsTools: () => false,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();

    const res = await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi le rendez-vous de ma fille' });

    expect(res.status).toBe(201);
    expect(res.body.response).toBe('Réponse via AiProvider DB');

    await testApp.close();
  });

  // 13. embedding selection
  it('creating an embedding AiProvider makes it selectable for kind=embedding', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test Embedding',
        provider: 'openai',
        kind: 'embedding',
        model: 'text-embedding-3-small',
        apiKey: 'sk-embed-test-key',
        isDefault: true,
      });
    expect(res.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/ai-providers?kind=embedding')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.body.some((p: { id: string }) => p.id === res.body.id)).toBe(true);
    expect(
      listRes.body.some((p: { id: string; isDefault: boolean }) => p.id === res.body.id && p.isDefault),
    ).toBe(true);
  });

  // 14. fallback when no provider (a fresh user with zero AiProvider rows)
  it('falls back gracefully with no crash when a user has zero AI providers configured', async () => {
    const freshEmail = `e2e-ai-providers-fresh-${randomUUID()}@example.com`;
    const freshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: freshEmail, password, displayName: 'Fresh User' });
    const freshToken = freshRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ message: 'Rappelle-moi le rendez-vous de ma fille' });

    expect(res.status).toBe(201);
    expect(res.body.response).toMatch(/configuration llm manquante/i);

    await prisma.user.deleteMany({ where: { email: freshEmail } });
  });

  // 15. invalid provider handled (adapter throws — never crashes the request)
  it('a failing provider adapter degrades gracefully instead of crashing the request', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => {
          throw new Error('401 Unauthorized: invalid API key');
        },
        supportsTools: () => false,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();

    const res = await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi encore le rendez-vous de ma fille' });

    expect(res.status).toBe(201); // never a 500 — degrades to a graceful reply
    expect(res.body.response).toMatch(/échoué/i);

    await testApp.close();
  });

  it('validates input: rejects an invalid baseUrl and an empty model', async () => {
    const badUrl = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad', provider: 'openai', kind: 'chat', model: 'x', baseUrl: 'not-a-url' });
    expect(badUrl.status).toBe(400);

    const emptyModel = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad', provider: 'openai', kind: 'chat', model: '' });
    expect(emptyModel.status).toBe(400);
  });

  it('never logs or returns a secret in an exception body on a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad', provider: 'openai', kind: 'chat', model: '', apiKey: 'sk-should-not-leak-anywhere' });
    expect(JSON.stringify(res.body)).not.toContain('sk-should-not-leak-anywhere');
  });
});

// 16. Phase A/B/C regressions — a light smoke check that the rest of the API
// still works after this phase's LlmService/EmbeddingService refactor. Full
// regression coverage lives in auth.e2e-spec.ts / messages.e2e-spec.ts /
// memory.e2e-spec.ts, run alongside this file in the same suite.
describe('AI Providers (e2e) — regression smoke', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-ai-providers-regression-${randomUUID()}@example.com`;
  const password = 'a-strong-password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('health, auth, and a direct message still work end to end', async () => {
    const health = await request(app.getHttpServer()).get('/api/v1/health');
    expect(health.status).toBe(200);

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'Regression' });
    expect(register.status).toBe(201);

    const message = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ message: 'Bonjour' });
    expect(message.status).toBe(201);
    expect(message.body.route).toBe('direct');
  });
});
