import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { upsertOwner } from '../src/users/owner-provisioning.js';

/**
 * Private single-owner mode (MORA_ALLOW_PUBLIC_REGISTRATION). `.env.test`
 * turns registration ON so the other suites can create users; this suite
 * also flips it OFF at runtime to check the staging/production behaviour.
 * The owner is provisioned exactly like `npm run owner:upsert` does.
 */
describe('Private mode / owner ADMIN (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  const suffix = randomUUID();
  const ownerEmail = `owner-${suffix}@example.com`;
  const userEmail = `user-${suffix}@example.com`;
  const blockedEmail = `blocked-${suffix}@example.com`;
  const escalateEmail = `escalate-${suffix}@example.com`;
  const password = 'an-owner-strong-password';
  let ownerToken: string;
  let ownerRefresh: string;
  let userToken: string;
  const createdProviderIds: string[] = [];

  const server = () => app.getHttpServer();
  const setRegistration = (enabled: boolean) => config.set('app.allowPublicRegistration', enabled);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);

    await upsertOwner(prisma, { email: ownerEmail, password, displayName: 'Owner' });
  });

  afterAll(async () => {
    setRegistration(true);
    await prisma.aiProvider.deleteMany({ where: { id: { in: createdProviderIds } } });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, userEmail, blockedEmail, escalateEmail] } },
    });
    await app.close();
  });

  describe('registration ON (test env only)', () => {
    it('creates a standard USER account (201)', async () => {
      expect(config.get('app.allowPublicRegistration')).toBe(true);
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: userEmail, password, displayName: 'Standard' });
      expect(res.status).toBe(201);
      userToken = res.body.accessToken;
      const row = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
      expect(row.role).toBe(UserRole.USER);
    });

    it('never lets a registrant grant itself ADMIN', async () => {
      await request(server())
        .post('/api/v1/auth/register')
        .send({ email: escalateEmail, password, displayName: 'Escalate', role: 'ADMIN' });
      const row = await prisma.user.findUnique({ where: { email: escalateEmail } });
      expect(row?.role ?? UserRole.USER).toBe(UserRole.USER);
    });
  });

  describe('registration OFF (staging / production)', () => {
    beforeAll(() => setRegistration(false));
    afterAll(() => setRegistration(true));

    it('refuses POST /auth/register with a neutral 403 and creates nothing', async () => {
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: blockedEmail, password, displayName: 'Blocked' });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Registration is disabled.');
      expect(JSON.stringify(res.body)).not.toMatch(/MORA_|allowPublicRegistration|stack/i);
      expect(await prisma.user.findUnique({ where: { email: blockedEmail } })).toBeNull();
    });

    it('gives the same 403 for an existing email (no account enumeration)', async () => {
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: ownerEmail, password, displayName: 'Again' });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Registration is disabled.');
    });

    it('lets the existing ADMIN owner log in', async () => {
      const res = await request(server()).post('/api/v1/auth/login').send({ email: ownerEmail, password });
      expect(res.status).toBe(200);
      ownerToken = res.body.accessToken;
      ownerRefresh = res.body.refreshToken;

      const me = await request(server()).get('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`);
      expect(me.status).toBe(200);
      expect(me.body.role).toBe('ADMIN');
    });

    it('lets the ADMIN owner chat normally', async () => {
      const res = await request(server())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ message: 'Rappelle-moi ce que je dois faire demain' });
      expect(res.status).toBe(201);
      expect(res.body.route).toBe('personal');
      expect(typeof res.body.response).toBe('string');
    });

    it.each([
      '/api/v1/conversations',
      '/api/v1/memories',
      '/api/v1/tasks',
      '/api/v1/reminders',
      '/api/v1/contacts',
      '/api/v1/documents',
      '/api/v1/avatar/profile',
      '/api/v1/voice/status',
      '/api/v1/vision/status?scope=personal&space=personal',
      '/api/v1/email/accounts',
      '/api/v1/whatsapp/accounts',
      '/api/v1/ai-providers',
      '/api/v1/ai-providers/status',
      '/api/v1/tools',
      '/api/v1/bug-reports',
    ])('lets the ADMIN owner use %s', async (path) => {
      const res = await request(server()).get(path).set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });

    it('lets the ADMIN owner file a bug report', async () => {
      const res = await request(server())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ category: 'other', severity: 'low', title: 'Owner smoke', description: 'Private mode e2e' });
      expect(res.status).toBe(201);
    });

    it('lets the ADMIN owner manage SYSTEM providers end to end', async () => {
      const auth = (req: request.Test) => req.set('Authorization', `Bearer ${ownerToken}`);

      const created = await auth(request(server()).post('/api/v1/ai-providers/system')).send({
        name: `Owner system ${suffix}`,
        provider: 'openai',
        kind: 'chat',
        model: 'gpt-4o-mini',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'sk-e2e-owner-system-key-4242',
      });
      expect(created.status).toBe(201);
      const id: string = created.body.id;
      createdProviderIds.push(id);
      expect(created.body.isSystem).toBe(true);

      expect((await auth(request(server()).get('/api/v1/ai-providers/system'))).status).toBe(200);
      expect((await auth(request(server()).get(`/api/v1/ai-providers/system/${id}`))).status).toBe(200);
      expect(
        (await auth(request(server()).patch(`/api/v1/ai-providers/system/${id}`)).send({ name: 'renamed' })).status,
      ).toBe(200);
      const tested = await auth(request(server()).post(`/api/v1/ai-providers/system/${id}/test`));
      expect([200, 201]).toContain(tested.status);
      expect([200, 201]).toContain((await auth(request(server()).post(`/api/v1/ai-providers/system/${id}/disable`))).status);
      expect([200, 204]).toContain((await auth(request(server()).delete(`/api/v1/ai-providers/system/${id}`))).status);
    });

    it('refuses SYSTEM provider management to a standard user (403)', async () => {
      const auth = (req: request.Test) => req.set('Authorization', `Bearer ${userToken}`);
      expect((await auth(request(server()).get('/api/v1/ai-providers/system'))).status).toBe(403);
      expect(
        (
          await auth(request(server()).post('/api/v1/ai-providers/system')).send({
            name: 'x',
            provider: 'openai',
            kind: 'chat',
            model: 'gpt-4o-mini',
            apiKey: 'sk-e2e-denied-0000',
          })
        ).status,
      ).toBe(403);
      expect((await auth(request(server()).get('/api/v1/bug-reports'))).status).toBe(403);
    });

    it('keeps refresh and logout working with registration off', async () => {
      const refreshed = await request(server()).post('/api/v1/auth/refresh').send({ refreshToken: ownerRefresh });
      expect(refreshed.status).toBe(200);
      const rotated: string = refreshed.body.refreshToken;

      // The old refresh token was rotated out.
      expect((await request(server()).post('/api/v1/auth/refresh').send({ refreshToken: ownerRefresh })).status).toBe(401);

      expect((await request(server()).post('/api/v1/auth/logout').send({ refreshToken: rotated })).status).toBe(204);
      expect((await request(server()).post('/api/v1/auth/refresh').send({ refreshToken: rotated })).status).toBe(401);
    });
  });
});
