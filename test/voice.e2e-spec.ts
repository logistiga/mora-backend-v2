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

    it('accepts a valid token and confirms session.start with session.ready', async () => {
      const created = await request(baseUrl)
        .post('/api/v1/voice/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scope: 'personal', space: 'default' });

      const socket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${tokenA}`);
      const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.on('open', () => {
          socket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } }));
        });
        socket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.event === 'session.ready') resolve(parsed.data);
        });
        socket.on('error', reject);
      });

      expect(ready.sessionId).toBe(created.body.id);
      expect(ready.state).toBe('listening');
      expect(ready.protocolVersion).toBe(1);
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
  });
});
