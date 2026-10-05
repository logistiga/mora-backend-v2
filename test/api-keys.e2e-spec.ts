import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LLM_PROVIDER, type LlmCompletionResult } from '../src/llm/llm-provider.interface.js';

const silentLlm = {
  isConfigured: () => false,
  complete: async (): Promise<LlmCompletionResult> => ({ content: '', provider: 'none', model: 'none' }),
};

describe('Personal API keys (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-apikey-${randomUUID()}@example.com`;
  let jwt: string;
  let key: string;
  let keyId: string;

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
      .send({ email, password: 'a-strong-password', displayName: 'E2E ApiKey' });
    jwt = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('creates a key with a session token and shows the full key only once', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'ChatGPT test' });
    expect(res.status).toBe(201);
    key = res.body.key;
    keyId = res.body.id;
    expect(key.startsWith('mora_')).toBe(true);

    const list = await request(app.getHttpServer()).get('/api/v1/api-keys').set('Authorization', `Bearer ${jwt}`);
    expect(JSON.stringify(list.body)).not.toContain(key);
  });

  it('authenticates a normal route with X-Api-Key', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/skills').set('X-Api-Key', key);
    expect(res.status).toBe(200);
  });

  it('authenticates with Authorization: Bearer mora_…', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/skills').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
  });

  it('refuses a wrong key outright', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/skills').set('X-Api-Key', 'mora_not-a-real-key-000000000000');
    expect(res.status).toBe(401);
  });

  it('does not let an API key mint or list other keys', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/api-keys').set('X-Api-Key', key).send({ name: 'escalation' });
    expect(res.status).toBe(401);
    const list = await request(app.getHttpServer()).get('/api/v1/api-keys').set('X-Api-Key', key);
    expect(list.status).toBe(401);
  });

  it('stops working immediately once revoked', async () => {
    const del = await request(app.getHttpServer()).delete(`/api/v1/api-keys/${keyId}`).set('Authorization', `Bearer ${jwt}`);
    expect(del.status).toBe(200);
    const res = await request(app.getHttpServer()).get('/api/v1/skills').set('X-Api-Key', key);
    expect(res.status).toBe(401);
  });

  it('a session token still works normally after the key was revoked', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/skills').set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
  });
});
