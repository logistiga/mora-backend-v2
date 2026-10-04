import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LLM_PROVIDER, type LlmCompletionResult } from '../src/llm/llm-provider.interface.js';

// Real HTTP against the real stack. No Google credentials exist in the test env
// (.env.test), so these tests cover the server-side contract only: auth,
// state validation, the not-configured path, and the calendar switch. The real
// Google consent and API calls need a configured OAuth client and a human
// consent step, and are verified separately.
const silentLlm = {
  isConfigured: () => false,
  complete: async (): Promise<LlmCompletionResult> => ({ content: '', provider: 'none', model: 'none' }),
};

describe('Google integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-google-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(silentLlm)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Google' });
    accessToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('requires auth on every Google endpoint except the public callback', async () => {
    const status = await request(app.getHttpServer()).get('/api/v1/google/status');
    const authorize = await request(app.getHttpServer()).post('/api/v1/google/oauth/authorize');
    const disconnect = await request(app.getHttpServer()).delete('/api/v1/google/account');
    expect(status.status).toBe(401);
    expect(authorize.status).toBe(401);
    expect(disconnect.status).toBe(401);
  });

  it('reports a fresh user as not connected', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/google/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, googleEmail: null, scopes: [] });
  });

  it('refuses to start consent when the server has no Google OAuth client configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/google/oauth/authorize')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(503);
  });

  it('rejects a callback with a forged or missing state, without ever contacting Google', async () => {
    const forged = await request(app.getHttpServer()).get('/api/v1/google/oauth/callback').query({ code: 'x', state: 'forged' });
    expect(forged.status).toBe(503);

    const missing = await request(app.getHttpServer()).get('/api/v1/google/oauth/callback').query({ code: 'x' });
    expect(missing.status).toBe(400);
  });

  it('refuses to create a Gmail mailbox before a Google account is connected', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/google/gmail/account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('disconnect is idempotent when nothing is connected', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/google/account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disconnected: false });
  });

  it('switches the calendar skill to google and back, and rejects any other provider value', async () => {
    const toGoogle = await request(app.getHttpServer())
      .patch('/api/v1/skills/calendar/config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ config: { provider: 'google' } });
    expect(toGoogle.status).toBe(200);
    expect(toGoogle.body.provider).toBe('google');

    const listed = await request(app.getHttpServer()).get('/api/v1/skills').set('Authorization', `Bearer ${accessToken}`);
    expect(listed.body.find((s: { key: string }) => s.key === 'calendar').config).toEqual({ provider: 'google' });

    const back = await request(app.getHttpServer())
      .patch('/api/v1/skills/calendar/config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ config: { provider: 'mora' } });
    expect(back.body.provider).toBe('mora');

    const invalid = await request(app.getHttpServer())
      .patch('/api/v1/skills/calendar/config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ config: { provider: 'microsoft' } });
    expect(invalid.status).toBe(400);

    const unknownKey = await request(app.getHttpServer())
      .patch('/api/v1/skills/calendar/config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ config: { token: 'steal' } });
    expect(unknownKey.status).toBe(400);
  });
});
