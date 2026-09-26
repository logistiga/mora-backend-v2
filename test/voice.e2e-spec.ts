import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ToolExecutorService } from '../src/tools/tool-executor.service.js';

/**
 * Requires a running PostgreSQL (migrated, including the Phase F voice
 * tables) + Redis reachable via `.env.test`. No STT/TTS AiProvider is
 * configured in `.env.test`, so this suite exercises the real "no provider
 * configured" degraded path and the full session/security surface — it does
 * NOT exercise a real OpenAI STT/TTS call (see the Phase F report for the
 * manual real-provider verification performed separately, outside this
 * automated suite, against the developer's own OpenAI account).
 */
describe('Voice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let wsBaseUrl: string;

  const emailA = `e2e-voice-a-${randomUUID()}@example.com`;
  const emailB = `e2e-voice-b-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0); // real listening socket — required for the raw ws.Server attached to the HTTP server
    prisma = app.get(PrismaService);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsBaseUrl = `ws://127.0.0.1:${address.port}`;

    const resA = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ email: emailA, password, displayName: 'E2E Voice A' });
    tokenA = resA.body.accessToken;

    const resB = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ email: emailB, password, displayName: 'E2E Voice B' });
    tokenB = resB.body.accessToken;
  });

  afterAll(async () => {
    await prisma.voiceTurn.deleteMany({});
    await prisma.voiceSession.deleteMany({});
    await prisma.voiceProfile.deleteMany({});
    await prisma.reminder.deleteMany({ where: { title: { in: ['E2E voice confirmation test', 'E2E idempotence test'] } } });
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await app.close();
  });

  describe('REST: sessions', () => {
    it('rejects session creation without a token', async () => {
      const res = await request(baseUrl).post('/api/v1/voice/sessions').send({ scope: 'personal', space: 'default' });
      expect(res.status).toBe(401);
    });

    it('creates a voice session and returns it with status "created"', async () => {
      const res = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('created');
      expect(res.body.scope).toBe('personal');
      expect(res.body.language).toBe('auto');
      expect(res.body.mode).toBe('push_to_talk');
      expect(res.body.conversationId).toBeTypeOf('string');
    });

    it('refuses another user reading a session they do not own (403, ownership never leaked)', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const res = await request(baseUrl)
        .get(`/api/v1/voice/sessions/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(403);
    });

    it('ends a session it owns', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const res = await request(baseUrl)
        .post(`/api/v1/voice/sessions/${created.body.id}/end`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ended');
    });
  });

  describe('REST: profiles', () => {
    it('creates and lists a voice profile, never returning any API key field', async () => {
      const create = await request(baseUrl)
        .post('/api/v1/voice/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Voix par défaut', provider: 'openai', voiceId: 'alloy', language: 'fr' });
      expect(create.status).toBe(201);
      expect(create.body).not.toHaveProperty('apiKey');

      const list = await request(baseUrl).get('/api/v1/voice/profiles').set('Authorization', `Bearer ${tokenA}`);
      expect(list.status).toBe(200);
      expect(list.body.some((p: { id: string }) => p.id === create.body.id)).toBe(true);
    });
  });

  describe('REST: status', () => {
    it('reports protocol/audio-format contract and honest (false) provider configuration with no AiProvider configured', async () => {
      const res = await request(baseUrl).get('/api/v1/voice/status').set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.protocolVersion).toBe(1);
      expect(res.body.audioFormat.sampleRateHz).toBe(16000);
      expect(res.body.sttConfigured).toBe(false);
      expect(res.body.ttsConfigured).toBe(false);
    });

    /**
     * Regression test for a real gap found during Phase G validation:
     * VoiceController.getStatus() previously delegated straight to
     * AiProviderService.getStatus(), which only checks for a DEDICATED
     * kind='stt'/'tts' AiProvider row — it never accounted for
     * VoiceProviderResolverService's fallback to the user's own `chat`
     * OpenAI credentials (built in Phase F). A user with only a `chat`
     * provider therefore incorrectly saw sttConfigured/ttsConfigured=false
     * even though a real voice turn would have worked for them.
     */
    it('reports sttConfigured/ttsConfigured=true for a user with only a chat OpenAI provider (fallback resolution)', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/ai-providers')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Chat only', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini', apiKey: 'sk-fake-voice-status-test' });
      expect(created.status).toBe(201);

      const res = await request(baseUrl).get('/api/v1/voice/status').set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.sttConfigured).toBe(true);
      expect(res.body.ttsConfigured).toBe(true);

      await prisma.aiProvider.delete({ where: { id: created.body.id } });
    });
  });

  describe('Voice confirmation ownership (Phase G real-mic bug regression, G/H/I/J from the test matrix)', () => {
    /**
     * These exercise the REAL PendingActionService.approve/reject that
     * VoiceTurnRunnerService calls once VoiceConfirmationService classifies
     * a transcript as affirm/deny — proving the ownership/idempotence
     * boundary the voice layer depends on, without needing a real STT
     * provider (none is configured in .env.test). A pending_action is
     * created deterministically via ToolExecutorService directly (the same
     * service the Orchestrator itself calls), not via an LLM tool-call.
     */
    it('G. a pending action cannot be approved by a different user (403), only by its owner', async () => {
      const toolExecutor = app.get(ToolExecutorService);
      const payloadA = JSON.parse(Buffer.from(tokenA.split('.')[1], 'base64url').toString());
      const conversation = await prisma.conversation.create({ data: { userId: payloadA.sub } });

      const outcome = await toolExecutor.requestExecution(
        'create_reminder',
        { title: 'E2E voice confirmation test', remindAt: new Date(Date.now() + 3600_000).toISOString() },
        { userId: payloadA.sub, conversationId: conversation.id, scope: 'personal', space: 'default', route: 'personal' },
      );
      expect(outcome.kind).toBe('pending_confirmation');
      const pendingActionId = (outcome as { pendingActionId: string }).pendingActionId;

      const crossUserAttempt = await request(baseUrl)
        .post(`/api/v1/pending-actions/${pendingActionId}/approve`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(crossUserAttempt.status).toBe(403);

      const ownerAttempt = await request(baseUrl)
        .post(`/api/v1/pending-actions/${pendingActionId}/approve`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(ownerAttempt.status).toBe(201);
      expect(ownerAttempt.body.status).toBe('executed');
    });

    it('I. approving an already-approved pending action a second time never re-executes it (idempotent)', async () => {
      const toolExecutor = app.get(ToolExecutorService);
      const payloadA = JSON.parse(Buffer.from(tokenA.split('.')[1], 'base64url').toString());
      const conversation = await prisma.conversation.create({ data: { userId: payloadA.sub } });

      const outcome = await toolExecutor.requestExecution(
        'create_reminder',
        { title: 'E2E idempotence test', remindAt: new Date(Date.now() + 3600_000).toISOString() },
        { userId: payloadA.sub, conversationId: conversation.id, scope: 'personal', space: 'default', route: 'personal' },
      );
      const pendingActionId = (outcome as { pendingActionId: string }).pendingActionId;

      const first = await request(baseUrl)
        .post(`/api/v1/pending-actions/${pendingActionId}/approve`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('executed');

      const second = await request(baseUrl)
        .post(`/api/v1/pending-actions/${pendingActionId}/approve`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(second.status).toBe(201);
      expect(second.body.status).toBe('already_processed');

      const reminders = await prisma.reminder.count({ where: { title: 'E2E idempotence test' } });
      expect(reminders).toBe(1); // exactly one, never duplicated by the second approve
    });
  });

  describe('WebSocket: auth and session ownership', () => {
    it('closes the connection when no token is provided', async () => {
      const socket = new WebSocket(`${wsBaseUrl}/voice/ws`);
      const closeCode = await new Promise<number>((resolve) => {
        socket.on('close', (code) => resolve(code));
      });
      expect(closeCode).toBe(4001);
    });

    it('closes the connection when the token is invalid', async () => {
      const socket = new WebSocket(`${wsBaseUrl}/voice/ws?token=not-a-real-token`);
      const closeCode = await new Promise<number>((resolve) => {
        socket.on('close', (code) => resolve(code));
      });
      expect(closeCode).toBe(4001);
    });

    it('accepts a valid token and confirms session.start with session.ready plus avatar.state', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const socket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      const outcome = await new Promise<{ ready: Record<string, unknown>; avatar: Record<string, unknown> | null }>((resolve, reject) => {
        let ready: Record<string, unknown> | null = null;
        let avatar: Record<string, unknown> | null = null;
        socket.on('open', () => {
          socket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } }));
        });
        socket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'session.ready') ready = parsed.data;
          if (parsed.event === 'avatar.state') avatar = parsed.data;
          if (ready && avatar) resolve({ ready, avatar });
        });
        socket.on('error', reject);
      });

      expect(outcome.ready.sessionId).toBe(created.body.id);
      expect(outcome.ready.state).toBe('listening');
      expect(outcome.ready.protocolVersion).toBe(1);
      expect(outcome.avatar?.state).toBe('listening');
      expect(outcome.avatar?.channel).toBe('voice');
      expect(outcome.avatar?.expression).toBe('attentive');
      socket.close();
    });

    it('refuses a session.start for a session owned by a different user', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const socket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenB}`);
      const outcome = await new Promise<{ event: string; closeCode?: number }>((resolve, reject) => {
        socket.on('open', () => {
          socket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } }));
        });
        socket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'error') resolve({ event: parsed.data.code });
        });
        socket.on('close', (code) => resolve({ event: 'closed', closeCode: code }));
        socket.on('error', reject);
      });

      expect(['session_not_found']).toContain(outcome.event);
    });

    it('rejects a second concurrent socket for the same session', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const firstSocket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      await new Promise<void>((resolve) => {
        firstSocket.on('open', () => {
          firstSocket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } }));
        });
        firstSocket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'session.ready') resolve();
        });
      });

      const secondSocket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      const secondOutcome = await new Promise<string>((resolve) => {
        secondSocket.on('open', () => {
          secondSocket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } }));
        });
        secondSocket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'error') resolve(parsed.data.code);
        });
      });

      expect(secondOutcome).toBe('session_already_connected');
      firstSocket.close();
      secondSocket.close();
    });

    /**
     * Phase G real-mic bug fix, §F/§10/§11: a reconnect must never leave two
     * logical listeners/players alive for the same session. After the first
     * socket fully closes, the gateway's registry.destroy() removes its
     * runtime state — a second connection to the SAME sessionId must then
     * be accepted cleanly (not rejected as "already connected"), and the
     * "already_connected" guard must still correctly reject a THIRD
     * concurrent one while the second is active.
     */
    it('10/11. after the first socket closes, reconnecting to the same session works cleanly with no double listener', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const firstSocket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      await new Promise<void>((resolve) => {
        firstSocket.on('open', () => firstSocket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } })));
        firstSocket.on('message', (raw) => {
          if (JSON.parse(raw.toString()).event === 'session.ready') resolve();
        });
      });
      await new Promise<void>((resolve) => {
        firstSocket.on('close', () => resolve());
        firstSocket.close(1000, 'client_disconnect');
      });

      // Reconnect to the exact same sessionId — must succeed (not "already_connected").
      const secondSocket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      const secondReady = await new Promise<Record<string, unknown>>((resolve, reject) => {
        secondSocket.on('open', () => secondSocket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } })));
        secondSocket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'session.ready') resolve(parsed.data);
          if (parsed.event === 'error') reject(new Error(String(parsed.data?.code)));
        });
      });
      expect(secondReady.sessionId).toBe(created.body.id);

      // A THIRD concurrent connection while the second is still open must still be refused — the guard survived the reconnect cycle.
      const thirdSocket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      const thirdOutcome = await new Promise<string>((resolve) => {
        thirdSocket.on('open', () => thirdSocket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } })));
        thirdSocket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'error') resolve(parsed.data.code);
        });
      });
      expect(thirdOutcome).toBe('session_already_connected');

      secondSocket.close();
      thirdSocket.close();
    });
  });
});
