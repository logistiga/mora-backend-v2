import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Targeted validation of 32a274d: all-space calendar listing, notification
 * type filter, and REST/WS voice session end propagation.
 */
describe('Stabilization final 32a274d (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let wsBaseUrl: string;
  const emailA = `e2e-sf-a-${randomUUID()}@example.com`;
  const emailB = `e2e-sf-b-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let tokenA: string;
  let tokenB: string;
  let userA: string;
  let userB: string;

  const from = '2030-01-01T00:00:00.000Z';
  const to = '2030-01-31T23:59:59.000Z';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsBaseUrl = `ws://127.0.0.1:${address.port}`;

    tokenA = (await request(baseUrl).post('/api/v1/auth/register').send({ email: emailA, password, displayName: 'SF A' })).body.accessToken;
    tokenB = (await request(baseUrl).post('/api/v1/auth/register').send({ email: emailB, password, displayName: 'SF B' })).body.accessToken;
    userA = (await prisma.user.findUniqueOrThrow({ where: { email: emailA } })).id;
    userB = (await prisma.user.findUniqueOrThrow({ where: { email: emailB } })).id;

    const event = (userId: string, scope: string, space: string, title: string, status = 'confirmed') => ({
      userId, scope, space, title, status, timezone: 'UTC',
      startsAt: new Date('2030-01-10T09:00:00Z'), endsAt: new Date('2030-01-10T10:00:00Z'),
    });
    await prisma.calendarEvent.createMany({
      data: [
        event(userA, 'personal', 'personal', 'A-personal'),
        event(userA, 'professional', 'logistiga', 'A-logistiga'),
        event(userA, 'professional', 'piston', 'A-piston'),
        event(userA, 'professional', 'piston', 'A-piston-cancelled', 'cancelled'),
        event(userB, 'professional', 'logistiga', 'B-logistiga'),
      ],
    });
    await prisma.notification.createMany({
      data: [
        { userId: userA, type: 'reminder', title: 'A-reminder', message: 'x' },
        { userId: userA, type: 'system', title: 'A-system', message: 'x' },
        { userId: userA, type: 'reminder', title: 'A-reminder-read', message: 'x', status: 'read' },
        { userId: userB, type: 'reminder', title: 'B-reminder', message: 'x' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.voiceTurn.deleteMany({ where: { session: { userId: { in: [userA, userB] } } } }).catch(() => undefined);
    await prisma.voiceSession.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await app.close();
  });

  const titles = (body: Array<{ title: string }>) => body.map((e) => e.title).sort();

  describe('AGENDA — all-space listing', () => {
    it('lists every space of the scope when space is omitted (cancelled excluded)', async () => {
      const res = await request(baseUrl).get('/api/v1/calendar/events').query({ scope: 'professional', from, to }).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(titles(res.body)).toEqual(['A-logistiga', 'A-piston']);
    });

    it('still filters on a single space when given', async () => {
      const res = await request(baseUrl).get('/api/v1/calendar/events').query({ scope: 'professional', space: 'piston', from, to }).set('Authorization', `Bearer ${tokenA}`);
      expect(titles(res.body)).toEqual(['A-piston']);
    });

    it('keeps scope isolation: personal never returns professional events, and scope defaults to personal', async () => {
      const explicit = await request(baseUrl).get('/api/v1/calendar/events').query({ scope: 'personal', from, to }).set('Authorization', `Bearer ${tokenA}`);
      const defaulted = await request(baseUrl).get('/api/v1/calendar/events').query({ from, to }).set('Authorization', `Bearer ${tokenA}`);
      expect(titles(explicit.body)).toEqual(['A-personal']);
      expect(titles(defaulted.body)).toEqual(['A-personal']);
    });

    it('keeps user isolation: another user never sees these events', async () => {
      const res = await request(baseUrl).get('/api/v1/calendar/events').query({ scope: 'professional', from, to }).set('Authorization', `Bearer ${tokenB}`);
      expect(titles(res.body)).toEqual(['B-logistiga']);
    });
  });

  describe('NOTIFICATIONS — type filter', () => {
    it('filters on type and still only returns the caller notifications', async () => {
      const res = await request(baseUrl).get('/api/v1/notifications').query({ type: 'reminder' }).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(titles(res.body)).toEqual(['A-reminder', 'A-reminder-read']);
    });

    it('combines type and status', async () => {
      const res = await request(baseUrl).get('/api/v1/notifications').query({ type: 'reminder', status: 'unread' }).set('Authorization', `Bearer ${tokenA}`);
      expect(titles(res.body)).toEqual(['A-reminder']);
    });

    it('without type returns all the caller notifications (backward compatible)', async () => {
      const res = await request(baseUrl).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenA}`);
      expect(titles(res.body)).toEqual(['A-reminder', 'A-reminder-read', 'A-system']);
    });

    it('rejects an over-long type (400) and never leaks another user', async () => {
      const long = await request(baseUrl).get('/api/v1/notifications').query({ type: 'x'.repeat(65) }).set('Authorization', `Bearer ${tokenA}`);
      expect(long.status).toBe(400);
      const b = await request(baseUrl).get('/api/v1/notifications').query({ type: 'reminder' }).set('Authorization', `Bearer ${tokenB}`);
      expect(titles(b.body)).toEqual(['B-reminder']);
    });
  });

  describe('VOICE — session end propagation', () => {
    async function openSession(token: string) {
      const created = await request(baseUrl).post('/api/v1/voice/sessions').set('Authorization', `Bearer ${token}`).send({ scope: 'personal', space: 'default' });
      const socket = new WebSocket(`${wsBaseUrl}/voice/ws?token=${token}`);
      const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
      const closed = new Promise<{ code: number }>((resolve) => socket.on('close', (code) => resolve({ code })));
      await new Promise<void>((resolve, reject) => {
        socket.on('open', () => socket.send(JSON.stringify({ event: 'session.start', data: { sessionId: created.body.id } })));
        socket.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString());
          events.push(parsed);
          if (parsed.event === 'session.ready') resolve();
        });
        socket.on('error', reject);
      });
      return { id: created.body.id as string, socket, events, closed };
    }

    /** Events received after session.ready, avatar.state flattened to "avatar.state:<state>". */
    function endSequence(events: Array<{ event: string; data?: Record<string, unknown> }>) {
      const afterReady = events.slice(events.findIndex((e) => e.event === 'session.ready') + 1);
      return afterReady
        .map((e) => (e.event === 'avatar.state' ? `avatar.state:${String(e.data?.state)}` : e.event))
        .filter((e) => e !== 'avatar.state:listening' && e !== 'assistant.expression');
    }

    async function expectCleanEnd(s: Awaited<ReturnType<typeof openSession>>) {
      const { code } = await s.closed;
      expect(code).toBe(1000);
      // Exactly once each, in the documented order.
      expect(endSequence(s.events)).toEqual(['avatar.state:disconnected', 'session.ended']);
      expect((await prisma.voiceSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ended');
    }

    it('WS session.end: avatar.state disconnected → session.ended → close 1000, no duplicate, DB ended (regression)', async () => {
      const s = await openSession(tokenA);
      s.socket.send(JSON.stringify({ event: 'session.end' }));
      await expectCleanEnd(s);
    });

    it('REST end: same sequence on the live socket (disconnected → session.ended → 1000), DB ended', async () => {
      const s = await openSession(tokenA);
      const res = await request(baseUrl).post(`/api/v1/voice/sessions/${s.id}/end`).set('Authorization', `Bearer ${tokenA}`);
      expect([200, 201]).toContain(res.status);
      await expectCleanEnd(s);
    });

    it('REST end after WS end is idempotent: nothing more is emitted and the session stays ended', async () => {
      const s = await openSession(tokenA);
      s.socket.send(JSON.stringify({ event: 'session.end' }));
      await expectCleanEnd(s);
      const again = await request(baseUrl).post(`/api/v1/voice/sessions/${s.id}/end`).set('Authorization', `Bearer ${tokenA}`);
      expect([200, 201]).toContain(again.status);
      expect(again.body.status).toBe('ended');
    });

    it('another user gets 403 and the owner socket is left untouched (no event, still open)', async () => {
      const s = await openSession(tokenA);
      const before = s.events.length;
      const res = await request(baseUrl).post(`/api/v1/voice/sessions/${s.id}/end`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(s.socket.readyState).toBe(WebSocket.OPEN);
      expect(s.events.slice(before).map((e) => e.event)).not.toContain('session.ended');
      expect((await prisma.voiceSession.findUniqueOrThrow({ where: { id: s.id } })).status).not.toBe('ended');
      s.socket.close();
      await s.closed;
    });
  });
});
