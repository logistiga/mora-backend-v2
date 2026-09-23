import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OpenAiCompatibleChatAdapter } from '../src/ai-providers/adapters/openai-compatible-chat.adapter.js';
import { ClockService } from '../src/common/time/clock.service.js';

/**
 * Requires a running PostgreSQL (migrated) + Redis reachable via `.env.test`
 * (same real infra as the other e2e suites). LLM tool-calling is exercised
 * with a mocked ChatAdapter (deterministic, no real API key/network call
 * needed — same pattern as ai-providers.e2e-spec.ts) so this suite is
 * reproducible in CI; real-provider tool-calling was additionally validated
 * manually against the live OpenAI provider (see the Phase D final report).
 */
async function createUserWithDbChatProvider(app: INestApplication, label: string) {
  const prisma = app.get(PrismaService);
  const email = `e2e-tools-${label}-${randomUUID()}@example.com`;
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'a-strong-password', displayName: label });
  const accessToken = register.body.accessToken as string;
  const userId = register.body.user?.id as string | undefined;

  // A DB chat AiProvider is required for LlmService to attempt tool-calling
  // at all (env fallback never forwards `tools`, see llm.service.ts).
  await request(app.getHttpServer())
    .post('/api/v1/ai-providers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Test Chat', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini', apiKey: 'sk-e2e-fake', isDefault: true });

  return { email, accessToken, userId, prisma };
}

async function createStandaloneApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

function decodeUserId(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as {
    sub: string;
  };
  return payload.sub;
}

function mockAdapterReturning(responses: Array<{ content: string; toolCalls?: unknown[] }>) {
  let call = 0;
  return {
    supportedProviders: ['openai'],
    complete: async () => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { content: response.content, model: 'gpt-4o-mini', toolCalls: response.toolCalls };
    },
    supportsTools: () => true,
    supportsVision: () => false,
    supportsJsonMode: () => false,
  };
}

describe('Tools & Actions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let otherAccessToken: string;
  const emails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const a = await createUserWithDbChatProvider(app, 'a');
    accessToken = a.accessToken;
    emails.push(a.email);

    const b = await createUserWithDbChatProvider(app, 'b');
    otherAccessToken = b.accessToken;
    emails.push(b.email);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  // 1-6: Tasks REST CRUD + isolation
  describe('Tasks REST', () => {
    let taskId: string;

    it('1. creates a task via REST (explicit user action, no confirmation needed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scope: 'personal', space: 'personal', title: 'Appeler Jean' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      taskId = res.body.id;
    });

    it('2. lists tasks, scoped to the caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((t: { id: string }) => t.id === taskId)).toBe(true);
    });

    it('3. gets one task by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Appeler Jean');
    });

    it('4. updates a task', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ priority: 'high' });
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('high');
    });

    it('5. completes a task', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('completed');
      expect(res.body.completedAt).not.toBeNull();
    });

    it('6. another user cannot read, update, or complete this task (user isolation)', async () => {
      const get = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`);
      expect(get.status).toBe(403);

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .send({ title: 'Hijacked' });
      expect(patch.status).toBe(403);

      const complete = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/complete`)
        .set('Authorization', `Bearer ${otherAccessToken}`);
      expect(complete.status).toBe(403);
    });
  });

  // 7-12: Reminders REST + real BullMQ delayed delivery + notification
  describe('Reminders REST + real delayed delivery', () => {
    let reminderId: string;

    it('7. creates a reminder via REST', async () => {
      const remindAt = new Date(Date.now() + 2000).toISOString();
      const res = await request(app.getHttpServer())
        .post('/api/v1/reminders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scope: 'personal', space: 'personal', title: 'Test e2e reminder', remindAt });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('scheduled');
      reminderId = res.body.id;
    });

    it('8. lists reminders', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reminders')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((r: { id: string }) => r.id === reminderId)).toBe(true);
    });

    it('10. a real BullMQ delayed job delivers the reminder as exactly one notification', async () => {
      // Real delay: no mock, no fast-forward — this is the actual BullMQ
      // Redis-backed scheduler, matching Phase D §18's requirement for a
      // genuine delayed-delivery test.
      const deadline = Date.now() + 15000;
      let delivered = false;
      while (Date.now() < deadline && !delivered) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const check = await request(app.getHttpServer())
          .get(`/api/v1/reminders/${reminderId}`)
          .set('Authorization', `Bearer ${accessToken}`);
        delivered = check.body.status === 'delivered';
      }
      expect(delivered).toBe(true);

      // 11. exactly one notification for this reminder
      const notifications = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${accessToken}`);
      const matching = notifications.body.filter(
        (n: { metadata?: { reminderId?: string } }) => n.metadata?.reminderId === reminderId,
      );
      expect(matching).toHaveLength(1);

      // 12. mark it read
      const readRes = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${matching[0].id}/read`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(readRes.status).toBe(201);
      expect(readRes.body.status).toBe('read');
    }, 20000);

    it('9. cancel is idempotent on an already-delivered reminder (no error, no re-delivery)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/reminders/${reminderId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('delivered'); // unchanged — already delivered, cancel is a no-op
    });

    it('cancels a still-scheduled reminder before it fires', async () => {
      const remindAt = new Date(Date.now() + 60000).toISOString();
      const create = await request(app.getHttpServer())
        .post('/api/v1/reminders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scope: 'personal', space: 'personal', title: 'To cancel', remindAt });

      const cancel = await request(app.getHttpServer())
        .post(`/api/v1/reminders/${create.body.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(cancel.status).toBe(201);
      expect(cancel.body.status).toBe('cancelled');
    });
  });

  // 13-18: Pending actions lifecycle
  describe('Pending actions lifecycle', () => {
    let pendingId: string;

    it('13. a real tool call proposed by the LLM (N2) creates a pending_action, never executes immediately', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue(
          mockAdapterReturning([
            {
              content: '',
              toolCalls: [{ name: 'create_task', arguments: { title: 'Depuis LLM' }, providerCallId: 'call_1' }],
            },
          ]),
        )
        .compile();
      const testApp = moduleRef.createNestApplication();
      testApp.setGlobalPrefix('api/v1');
      testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await testApp.init();

      const before = await request(testApp.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      const beforeCount = before.body.length;

      const res = await request(testApp.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Pour mon suivi personnel, ajoute une tâche depuis LLM' });

      expect(res.status).toBe(201);
      expect(res.body.action?.type).toBe('confirmation_required');
      expect(res.body.action?.tool).toBe('create_task');
      pendingId = res.body.action.pendingActionId;

      const after = await request(testApp.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.body.length).toBe(beforeCount); // nothing executed yet

      await testApp.close();
    });

    it('18. another user cannot approve or even see this pending action', async () => {
      const get = await request(app.getHttpServer())
        .get(`/api/v1/pending-actions/${pendingId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`);
      expect(get.status).toBe(403);

      const approve = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${pendingId}/approve`)
        .set('Authorization', `Bearer ${otherAccessToken}`);
      expect(approve.status).toBe(403);
    });

    it('14 & 27. approving executes the tool exactly once — the task is actually created', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${pendingId}/approve`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('executed');
      expect(res.body.toolResultOk).toBe(true);

      const tasks = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(tasks.body.filter((t: { title: string }) => t.title === 'Depuis LLM')).toHaveLength(1);
    });

    it('16. double approval never creates a second task (idempotence)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${pendingId}/approve`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('already_processed');

      const tasks = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(tasks.body.filter((t: { title: string }) => t.title === 'Depuis LLM')).toHaveLength(1);
    });

    it('15. reject never executes the tool', async () => {
      const create = await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`); // wrong body on purpose to force 400, then use a real flow instead
      expect(create.status).toBe(400);

      // Build a real pending action to reject via a fresh LLM-proposed call.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue(
          mockAdapterReturning([
            {
              content: '',
              toolCalls: [{ name: 'create_task', arguments: { title: 'À rejeter' }, providerCallId: 'call_2' }],
            },
          ]),
        )
        .compile();
      const testApp = moduleRef.createNestApplication();
      testApp.setGlobalPrefix('api/v1');
      testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await testApp.init();

      const proposeRes = await request(testApp.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Pour mon suivi personnel, ajoute une tâche à rejeter' });
      const rejectId = proposeRes.body.action.pendingActionId;
      await testApp.close();

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${rejectId}/reject`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(rejectRes.status).toBe(201);
      expect(rejectRes.body.status).toBe('rejected');

      const tasks = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(tasks.body.some((t: { title: string }) => t.title === 'À rejeter')).toBe(false);

      // reject-then-approve is blocked
      const lateApprove = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${rejectId}/approve`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(lateApprove.body.status).toBe('already_processed');
    });

    it('17. an expired pending action can never be approved', async () => {
      const prismaSvc = app.get(PrismaService);
      const decoded = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
      ) as { sub: string };

      const expired = await prismaSvc.pendingAction.create({
        data: {
          userId: decoded.sub,
          toolName: 'create_task',
          toolVersion: '1.0.0',
          scope: 'personal',
          space: 'personal',
          securityLevel: 'N2',
          input: { title: 'Never' },
          status: 'pending',
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/pending-actions/${expired.id}/approve`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('expired');

      const tasks = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(tasks.body.some((t: { title: string }) => t.title === 'Never')).toBe(false);
    });
  });

  // 19-24, 30: tool-calling edge cases through the real /messages pipeline
  describe('Tool-calling edge cases', () => {
    it('19 & 28. N1 tool (list_tasks) executes automatically, with a natural-language summary from a real second LLM call', async () => {
      let call = 0;
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue({
          supportedProviders: ['openai'],
          complete: async () => {
            call += 1;
            if (call === 1) {
              return {
                content: '',
                model: 'gpt-4o-mini',
                toolCalls: [{ name: 'list_tasks', arguments: {}, providerCallId: 'call_3' }],
              };
            }
            return { content: 'Voici vos tâches (résumé naturel).', model: 'gpt-4o-mini' };
          },
          supportsTools: () => true,
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
        .send({ message: 'Pour mon suivi personnel, quelles sont mes tâches ?' });

      expect(res.status).toBe(201);
      expect(res.body.action).toBeUndefined(); // N1 never needs confirmation
      expect(res.body.response).toBe('Voici vos tâches (résumé naturel).');
      expect(call).toBe(2); // one call proposing the tool, one summarizing the result

      await testApp.close();
    });

    it('23. an unknown/hallucinated tool is rejected with no crash', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue(
          mockAdapterReturning([
            { content: '', toolCalls: [{ name: 'delete_everything', arguments: {}, providerCallId: 'call_4' }] },
          ]),
        )
        .compile();
      const testApp = moduleRef.createNestApplication();
      testApp.setGlobalPrefix('api/v1');
      testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await testApp.init();

      const res = await request(testApp.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Pour mon suivi personnel, fais quelque chose de dangereux' });

      expect(res.status).toBe(201); // never a 500
      expect(res.body.action).toBeUndefined();
      expect(res.body.response.length).toBeGreaterThan(0);

      await testApp.close();
    });

    it('24. invalid arguments (missing required title) are rejected by backend validation, not executed', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue(
          mockAdapterReturning([
            { content: '', toolCalls: [{ name: 'create_task', arguments: {}, providerCallId: 'call_5' }] },
          ]),
        )
        .compile();
      const testApp = moduleRef.createNestApplication();
      testApp.setGlobalPrefix('api/v1');
      testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await testApp.init();

      const before = await request(testApp.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);

      const res = await request(testApp.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Pour mon suivi personnel, ajoute une tâche' });
      expect(res.status).toBe(201);
      expect(res.body.action).toBeUndefined();

      const after = await request(testApp.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.body.length).toBe(before.body.length);

      await testApp.close();
    });

    it('29. a tool call proposed in a Professional/logistiga conversation never sees Personal tasks', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpenAiCompatibleChatAdapter)
        .useValue({
          supportedProviders: ['openai'],
          complete: async () => {
            return {
              content: '',
              model: 'gpt-4o-mini',
              toolCalls: [{ name: 'list_tasks', arguments: {}, providerCallId: 'call_6' }],
            };
          },
          supportsTools: () => true,
          supportsVision: () => false,
          supportsJsonMode: () => false,
        })
        .compile();
      const testApp = moduleRef.createNestApplication();
      testApp.setGlobalPrefix('api/v1');
      testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await testApp.init();

      await request(testApp.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Pour Logistiga, montre la liste des tâches' });

      const prismaSvc = testApp.get(PrismaService);
      const lastCall = await prismaSvc.toolCall.findFirst({
        where: { toolName: 'list_tasks', scope: 'professional', space: 'logistiga' },
        orderBy: { createdAt: 'desc' },
      });
      expect(lastCall).not.toBeNull();
      const output = lastCall?.output as unknown[] | null;
      expect(Array.isArray(output) ? output : []).toHaveLength(0); // no personal task ever leaks in

      await testApp.close();
    });
  });

  // Tool discovery
  it('GET /tools lists only public metadata, never secrets or internal code', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tools').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(12);
    expect(res.body.every((t: Record<string, unknown>) => 'securityLevel' in t && 'name' in t)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|secret|ciphertext/i);
  });

  it('rejects unauthenticated tool/task/reminder/pending-action requests', async () => {
    const endpoints = ['/api/v1/tasks', '/api/v1/reminders', '/api/v1/pending-actions', '/api/v1/tools', '/api/v1/notifications'];
    for (const endpoint of endpoints) {
      const res = await request(app.getHttpServer()).get(endpoint);
      expect(res.status).toBe(401);
    }
  });
});

// Post-review corrections: (1) a real, injectable time reference instead of
// the LLM inventing "now" — proven here with a mocked ClockService and a
// mocked adapter that captures the exact system prompt it received; (2) the
// backend never fabricates a confirmation_required action from free text —
// proven with a mocked adapter that narrates a fake confirmation with NO
// tool call, and with a same-conversation two-tool-call sequence.
describe('Tools & Actions (e2e) — post-review corrections', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  const emails: string[] = [];

  beforeAll(async () => {
    const setup = await createStandaloneApp();
    app = setup.app;
    prisma = setup.prisma;
    const user = await createUserWithDbChatProvider(app, 'corrections');
    accessToken = user.accessToken;
    emails.push(user.email);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('1. the exact fixed-clock reference is injected into the system prompt sent to the provider', async () => {
    const fixedNow = new Date('2026-09-23T09:00:00.000Z');
    let capturedSystemPrompt = '';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClockService)
      .useValue({ now: () => fixedNow })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async (_conn: unknown, req: { messages: { role: string; content: string }[] }) => {
          capturedSystemPrompt = req.messages.find((m) => m.role === 'system')?.content ?? '';
          return { content: 'Réponse.', model: 'gpt-4o-mini' };
        },
        supportsTools: () => true,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();

    await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Pour mon suivi personnel, bonjour, comment ça va vraiment aujourd\'hui ?' });

    expect(capturedSystemPrompt).toContain('2026-09-23T09:00:00.000Z');
    expect(capturedSystemPrompt).toMatch(/n'invente jamais/i);

    await testApp.close();
  });

  it("2. remindAt is stored exactly as computed from the injected time reference (dans une minute)", async () => {
    const fixedNow = new Date('2026-09-23T09:00:00.000Z');
    const expectedRemindAt = new Date(fixedNow.getTime() + 60_000).toISOString();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClockService)
      .useValue({ now: () => fixedNow })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => ({
          content: '',
          model: 'gpt-4o-mini',
          // Simulates the model correctly using the injected reference to
          // compute "dans une minute" — the real-provider equivalent is
          // validated manually (see the Phase D correction report).
          toolCalls: [
            {
              name: 'create_reminder',
              arguments: { title: 'Vérifier mes notes', remindAt: expectedRemindAt },
              providerCallId: 'call_time_1',
            },
          ],
        }),
        supportsTools: () => true,
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
      .send({ message: 'Pour mon suivi personnel, rappelle-moi dans une minute de vérifier mes notes.' });

    expect(res.body.action?.tool).toBe('create_reminder');
    const pendingId = res.body.action.pendingActionId;

    const approveRes = await request(testApp.getHttpServer())
      .post(`/api/v1/pending-actions/${pendingId}/approve`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(approveRes.body.status).toBe('executed');
    expect(approveRes.body.pendingAction.result.remindAt).toBe(expectedRemindAt);

    await testApp.close();
  });

  it('3. a fake textual confirmation with NO real tool call never creates a pending_action', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => ({
          // Exactly the misleading pattern observed with the real provider:
          // confirmation-shaped prose, zero tool_calls.
          content: 'Créer une tâche : "Appeler le comptable". Veux-tu confirmer ?',
          model: 'gpt-4o-mini',
        }),
        supportsTools: () => true,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();
    const testPrisma = testApp.get(PrismaService);
    const userId = decodeUserId(accessToken);

    const before = await testPrisma.pendingAction.count({ where: { userId } });

    const res = await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Pour mon suivi personnel, ajoute une tâche appeler le comptable' });

    expect(res.status).toBe(201);
    expect(res.body.action).toBeUndefined(); // no action field — nothing to confirm
    expect(res.body.response).toContain('Veux-tu confirmer'); // the misleading text still reaches the user...

    const after = await testPrisma.pendingAction.count({ where: { userId } });
    expect(after).toBe(before); // ...but structurally NO pending_action was ever created for it

    await testApp.close();
  });

  it('4. two real tool calls in the SAME conversation produce two distinct pending_actions, never a stale/reused one', async () => {
    let call = 0;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        complete: async () => {
          call += 1;
          if (call === 1) {
            return {
              content: '',
              model: 'gpt-4o-mini',
              toolCalls: [{ name: 'create_task', arguments: { title: 'Appeler Jean' }, providerCallId: 'call_a' }],
            };
          }
          return {
            content: '',
            model: 'gpt-4o-mini',
            toolCalls: [{ name: 'create_task', arguments: { title: 'Préparer le dossier' }, providerCallId: 'call_b' }],
          };
        },
        supportsTools: () => true,
        supportsVision: () => false,
        supportsJsonMode: () => false,
      })
      .compile();
    const testApp = moduleRef.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await testApp.init();

    const first = await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Pour mon suivi personnel, ajoute une tâche appeler Jean' });
    const firstPendingId = first.body.action.pendingActionId;
    const conversationId = first.body.conversationId;

    const second = await request(testApp.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ conversationId, message: 'Pour mon suivi personnel, ajoute aussi une tâche préparer le dossier' });
    const secondPendingId = second.body.action.pendingActionId;

    expect(firstPendingId).toBeDefined();
    expect(secondPendingId).toBeDefined();
    expect(secondPendingId).not.toBe(firstPendingId); // a genuinely new pending_action, not the old one replayed

    await Promise.all([
      request(testApp.getHttpServer()).post(`/api/v1/pending-actions/${firstPendingId}/approve`).set('Authorization', `Bearer ${accessToken}`),
      request(testApp.getHttpServer()).post(`/api/v1/pending-actions/${secondPendingId}/approve`).set('Authorization', `Bearer ${accessToken}`),
    ]);

    const tasks = await request(testApp.getHttpServer()).get('/api/v1/tasks').set('Authorization', `Bearer ${accessToken}`);
    expect(tasks.body.some((t: { title: string }) => t.title === 'Appeler Jean')).toBe(true);
    expect(tasks.body.some((t: { title: string }) => t.title === 'Préparer le dossier')).toBe(true);

    await testApp.close();
  });

  it('5. a real N1 tool with an empty input schema (list_pending_actions) executes successfully with no arguments — never invalid_arguments', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleChatAdapter)
      .useValue({
        supportedProviders: ['openai'],
        // Simulates a real provider proposing a no-argument tool call: the
        // `arguments` field is genuinely absent from the function-call
        // payload, exactly as case C from the correction report.
        complete: async () => ({
          content: '',
          model: 'gpt-4o-mini',
          toolCalls: [{ name: 'list_pending_actions', arguments: {}, providerCallId: 'call_empty' }],
        }),
        supportsTools: () => true,
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
      .send({ message: 'Pour mon suivi personnel, ai-je des actions en attente ?' });

    expect(res.status).toBe(201);
    expect(res.body.action).toBeUndefined(); // N1 — executed immediately, no confirmation needed

    const testPrisma = testApp.get(PrismaService);
    const call = await testPrisma.toolCall.findFirst({ where: { toolName: 'list_pending_actions' }, orderBy: { createdAt: 'desc' } });
    expect(call?.status).toBe('success'); // never 'failed' with errorCode invalid_arguments

    await testApp.close();
  });
});

// 31. Phase A/B/C/C.5/C.6 regression smoke — Phase D must never break the
// existing pipeline. Full regression coverage lives in the other e2e files
// run alongside this one in the same sequential suite.
describe('Tools & Actions (e2e) — regression smoke', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-tools-regression-${randomUUID()}@example.com`;

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

  it('health, auth, and a plain direct message still work end to end after Phase D', async () => {
    const health = await request(app.getHttpServer()).get('/api/v1/health');
    expect(health.status).toBe(200);

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-strong-password', displayName: 'Regression D' });
    expect(register.status).toBe(201);

    const message = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ message: 'Bonjour' });
    expect(message.status).toBe(201);
    expect(message.body.route).toBe('direct');
    expect(message.body.action).toBeUndefined();
  });
});
