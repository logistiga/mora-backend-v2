import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LLM_PROVIDER, type LlmCompletionRequest, type LlmCompletionResult } from '../src/llm/llm-provider.interface.js';
import { MoraOrchestratorService } from '../src/orchestrator/mora-orchestrator.service.js';
import { ProfileFactsService, ESSENTIAL_SCOPE, ESSENTIAL_SPACE } from '../src/memory/profile-facts.service.js';

/**
 * End-to-end coverage for the learning-core phase (Essential User Profile),
 * against real Postgres/Redis/BullMQ — the same shape as memory.e2e-spec.ts,
 * but with the env-fallback LLM_PROVIDER overridden by a small scripted
 * fake so the router/extraction/direct-route LLM calls that this feature
 * depends on can be exercised deterministically, without a real API key.
 *
 * The fake inspects the outgoing system prompt to decide which "role" it is
 * playing for that particular call (router classification vs memory/essential
 * extraction vs a direct-route reply) — the three call sites this phase
 * touches — and returns a scripted, test-controlled response for each.
 */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 8000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

class ScriptedLlmProvider {
  readonly name = 'scripted-test-provider';
  /** Overridable per test: what the extraction call should propose next. */
  nextExtraction: { memories: unknown[]; essentialFacts: unknown[] } = { memories: [], essentialFacts: [] };
  /** Overridable per test: what a direct-route reply should say. */
  nextDirectReply = 'Réponse scriptée.';
  calls: LlmCompletionRequest[] = [];

  isConfigured(): boolean {
    return true;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';

    if (system.includes('You classify a user message for a routing system')) {
      // Router LLM fallback: only reached when no deterministic rule
      // matched — always resolve to 'personal' with high confidence so a
      // teaching instruction phrased in a way the regex doesn't catch still
      // lands somewhere it can be learned.
      return {
        content: JSON.stringify({ route: 'personal', space: 'personal', intent: 'learn_preference', confidence: 0.85 }),
        provider: this.name,
        model: 'scripted',
      };
    }

    if (system.includes('Tu identifies les informations DURABLES')) {
      return { content: JSON.stringify(this.nextExtraction), provider: this.name, model: 'scripted' };
    }

    // Direct-route (or agent) reply.
    return { content: this.nextDirectReply, provider: this.name, model: 'scripted' };
  }
}

describe('Learning core / Essential User Profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: MoraOrchestratorService;
  let profileFacts: ProfileFactsService;
  let scripted: ScriptedLlmProvider;
  const email = `e2e-learning-${randomUUID()}@example.com`;
  const otherEmail = `e2e-learning-other-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let userId: string;
  let otherUserId: string;
  let accessToken: string;
  let otherAccessToken: string;

  beforeAll(async () => {
    scripted = new ScriptedLlmProvider();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    orchestrator = app.get(MoraOrchestratorService);
    profileFacts = app.get(ProfileFactsService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Learning' });
    accessToken = res.body.accessToken;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    const otherRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: otherEmail, password, displayName: 'E2E Learning Other' });
    otherAccessToken = otherRes.body.accessToken;
    otherUserId = (await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  // Test A/B fixture: teach a durable, cross-scope language preference via
  // the real HTTP → orchestrator → router → personal agent → background
  // BullMQ extraction pipeline, then confirm it is immediately available —
  // no restart, no new session (test 6 / K).
  it('learns a durable language preference from a real personal-route turn and makes it immediately available (tests A, B, K)', async () => {
    scripted.nextExtraction = {
      memories: [],
      essentialFacts: [
        {
          key: 'language_behavior',
          value: "Répond systématiquement dans la langue utilisée par l'utilisateur (arabe, français, ou autre)",
          confidence: 0.9,
        },
      ],
    };
    scripted.nextDirectReply = "D'accord, je vais répondre dans la langue que tu utilises.";

    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        message: 'Rappelle-toi que quand je te parle en arabe, réponds en arabe, et en français si je parle français',
      });
    expect(res.status).toBe(201);
    // The learning-instruction router rule must land this on 'personal', not
    // 'direct' — the whole point of the fix (see MoraRouterService).
    expect(res.body.route).toBe('personal');

    await waitFor(async () => {
      const facts = await profileFacts.getEssential(userId);
      return facts.some((f) => f.key === 'language_behavior');
    });

    // Immediately available on the very next turn, no restart/new session —
    // simulated here as a brand new conversation (test K: a "restart" from
    // the conversation's point of view).
    const essential = await profileFacts.getEssential(userId);
    expect(essential.find((f) => f.key === 'language_behavior')?.value).toContain("langue utilisée par l'utilisateur");
  });

  // Test G / the actual reported bug: a DIRECT-routed greeting must still
  // consult the Essential User Profile — this is the literal regression
  // guard for "Salam" answering in French despite the taught preference.
  it('a direct-route greeting fetches the Essential User Profile (root-cause regression guard)', async () => {
    scripted.calls = [];
    scripted.nextDirectReply = 'مرحباً! كيف يمكنني مساعدتك؟';

    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Salam.' });

    expect(res.status).toBe(201);
    expect(res.body.route).toBe('direct');
    expect(res.body.response).toBe('مرحباً! كيف يمكنني مساعدتك؟');

    const directCall = scripted.calls.at(-1);
    const system = directCall?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('language_behavior');
  });

  // Test C: taught in Chat (channel: 'text', via the real HTTP path above),
  // used in Voice — exercised by calling the SAME orchestrator used by the
  // voice pipeline (voice-turn-runner.service.ts) with channel: 'voice'.
  // There is deliberately no separate "voice memory" — see AGENTS: voice is
  // a channel, not a second assistant.
  it('a preference taught in Chat is available on a Voice-channel orchestrator turn (test C)', async () => {
    scripted.nextDirectReply = 'ok';
    const result = await orchestrator.handleMessage({
      user: { id: userId, email, displayName: 'E2E Learning' },
      message: 'Bonjour',
      channel: 'voice',
    });
    expect(result.route).toBe('direct');

    const directCall = scripted.calls.at(-1);
    const system = directCall?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('language_behavior');
  });

  // Test D: taught via a Voice-channel turn, used later in Chat — same
  // underlying write path (ProfileFactsService.upsertEssential via the
  // background extraction job), so this is the symmetric case of test C.
  it('a preference taught on a Voice-channel turn is available on a later Chat turn (test D)', async () => {
    scripted.nextExtraction = {
      memories: [],
      essentialFacts: [{ key: 'form_of_address', value: 'Vouvoyer toujours (jamais tutoyer)', confidence: 0.85 }],
    };
    scripted.nextDirectReply = "D'accord.";

    await orchestrator.handleMessage({
      user: { id: userId, email, displayName: 'E2E Learning' },
      message: 'Rappelle-toi de toujours me vouvoyer, jamais me tutoyer, dans toutes nos conversations',
      channel: 'voice',
    });

    await waitFor(async () => (await profileFacts.getEssential(userId)).some((f) => f.key === 'form_of_address'));

    const viaChat = await request(app.getHttpServer())
      .get('/api/v1/profile-facts?scope=essential&space=essential')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(viaChat.status).toBe(200);
    expect(viaChat.body.some((f: { key: string }) => f.key === 'form_of_address')).toBe(true);
  });

  // Test E: correction/supersession — re-teaching the SAME key with a
  // different value supersedes the old one instead of accumulating
  // contradictory active rules.
  it('supersedes an existing essential fact when the same preference is corrected (test E)', async () => {
    const first = await profileFacts.upsertEssential(userId, {
      key: 'response_style',
      value: 'Réponses longues et détaillées',
      confidence: 0.8,
      source: 'manual',
    });

    const second = await profileFacts.upsertEssential(userId, {
      key: 'response_style',
      value: 'Finalement, réponses courtes et directes',
      confidence: 0.9,
      source: 'manual',
    });

    const oldRow = await prisma.profileFact.findUniqueOrThrow({ where: { id: first.id } });
    expect(oldRow.status).toBe('superseded');
    expect(oldRow.supersededById).toBe(second.id);

    const active = await profileFacts.getEssential(userId);
    const responseStyleFacts = active.filter((f) => f.key === 'response_style');
    expect(responseStyleFacts).toHaveLength(1);
    expect(responseStyleFacts[0].value).toContain('courtes et directes');
  });

  // Test H (adapted): essential facts are deliberately cross-scope BY
  // DESIGN (that is the entire point), so "isolation" here means something
  // different from a normal scope-bound Memory: an essential fact must
  // never appear in a scope-SPECIFIC query, only through getEssential /
  // GET /profile-facts?scope=essential. Scope-bound Memory's own isolation
  // is already covered in memory.e2e-spec.ts and is untouched by this phase.
  it('an essential fact never appears in a scope-specific ProfileFacts query (personal or professional)', async () => {
    await profileFacts.upsertEssential(userId, {
      key: 'greeting_style',
      value: 'Salutation chaleureuse et personnalisée',
      confidence: 0.8,
      source: 'manual',
    });

    const personalScoped = await request(app.getHttpServer())
      .get('/api/v1/profile-facts?scope=personal&space=personal')
      .set('Authorization', `Bearer ${accessToken}`);
    const professionalScoped = await request(app.getHttpServer())
      .get('/api/v1/profile-facts?scope=professional&space=general')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(personalScoped.body.some((f: { key: string }) => f.key === 'greeting_style')).toBe(false);
    expect(professionalScoped.body.some((f: { key: string }) => f.key === 'greeting_style')).toBe(false);

    const essentialScoped = await request(app.getHttpServer())
      .get(`/api/v1/profile-facts?scope=${ESSENTIAL_SCOPE}&space=${ESSENTIAL_SPACE}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(essentialScoped.body.some((f: { key: string }) => f.key === 'greeting_style')).toBe(true);
  });

  // Test I: different users never see each other's essential facts.
  it('never lets another user see or apply a taught essential preference (test I)', async () => {
    await profileFacts.upsertEssential(userId, {
      key: 'language_behavior_isolation_probe',
      value: 'only for the first user',
      confidence: 0.9,
      source: 'manual',
    });

    const otherEssential = await profileFacts.getEssential(otherUserId);
    expect(otherEssential.some((f) => f.key === 'language_behavior_isolation_probe')).toBe(false);

    const otherHttp = await request(app.getHttpServer())
      .get(`/api/v1/profile-facts?scope=${ESSENTIAL_SCOPE}&space=${ESSENTIAL_SPACE}`)
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(otherHttp.status).toBe(200);
    expect(otherHttp.body.some((f: { key: string }) => f.key === 'language_behavior_isolation_probe')).toBe(false);
  });

  // Test J: a secret-shaped value proposed by the (scripted) extraction LLM
  // is dropped before it ever reaches storage — real BullMQ job, real
  // secret-pattern guard (src/common/security/secret-patterns.ts).
  it('never persists a secret-shaped value proposed by the extraction LLM (test J)', async () => {
    scripted.nextExtraction = {
      memories: [],
      essentialFacts: [{ key: 'login_note', value: 'password=hunter2', confidence: 0.9 }],
    };
    scripted.nextDirectReply = 'ok';

    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-toi que mon mot de passe préféré à donner à Mora est password=hunter2 toujours' });
    expect(res.status).toBe(201);

    // Give the background job a moment to run (and NOT persist anything).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const essential = await profileFacts.getEssential(userId);
    expect(essential.some((f) => f.key === 'login_note')).toBe(false);
    const rawRow = await prisma.profileFact.findFirst({ where: { userId, key: 'login_note' } });
    expect(rawRow).toBeNull();
  });

  // Language-selection-policy fix regression guard: the REAL reported bug
  // (real staging voice test, post-learning-core) was that a bare "Salam"
  // worked reliably (handleDirect has its own language instruction) but
  // ordinary Arabic sentences later in the SAME conversation sometimes came
  // back in French — because once a conversation gains an active
  // personal/professional scope, applyConversationContinuity reroutes every
  // later non-greeting turn there, and the personal/professional agent path
  // (ContextBuilderService) had no language instruction at all. This test
  // reproduces that exact shape end-to-end (real HTTP, real router, real
  // ContextBuilder) and asserts the fix: the personal-route system prompt now
  // also carries the shared language policy.
  it('a later non-greeting turn in a conversation that already has an active personal scope still carries the language policy (language-selection-policy fix)', async () => {
    scripted.calls = [];
    scripted.nextDirectReply = "D'accord.";

    const first = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Mon rendez-vous personnel est prévu demain matin' });
    expect(first.status).toBe(201);
    expect(first.body.route).toBe('personal');
    const conversationId = first.body.conversationId;

    scripted.calls = [];
    const second = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId,
        // Short (<=3 words) and not a recognized greeting, so the router's
        // OWN deterministic rules alone (no LLM call at all) classify this as
        // 'direct' with intent 'information' — the exact shape that makes
        // MoraOrchestratorService.applyConversationContinuity reroute it into
        // the conversation's already-active personal scope instead.
        message: 'نعم بالتأكيد',
      });
    expect(second.status).toBe(201);
    // Continuity keeps it on the already-active personal scope, NOT direct —
    // this is what makes the language-instruction gap matter in the first
    // place (handleDirect alone would never have been enough).
    expect(second.body.route).toBe('personal');

    const personalCall = scripted.calls.at(-1);
    const systemMessages = personalCall?.messages.filter((m) => m.role === 'system').map((m) => m.content) ?? [];
    expect(systemMessages.some((content) => content.includes('Politique de langue'))).toBe(true);
  });

  it('essential profile-facts endpoints require auth', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/profile-facts?scope=${ESSENTIAL_SCOPE}`);
    expect(res.status).toBe(401);
  });
});
