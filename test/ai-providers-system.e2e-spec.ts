import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';

/**
 * SYSTEM providers (`ai_providers.user_id IS NULL`): shared credentials
 * supplied by Mora, manageable by ADMINs only, used as the fallback when a
 * user has no personal (BYOK) provider. All keys below are synthetic.
 */
describe('AI Providers SYSTEM (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userEmail = `e2e-sysprov-user-${randomUUID()}@example.com`;
  const adminEmail = `e2e-sysprov-admin-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let userToken: string;
  let adminToken: string;
  const createdSystemIds: string[] = [];

  const systemChatDto = {
    name: 'Mora Chat (system)',
    provider: 'openai',
    kind: 'chat',
    model: 'gpt-4o-mini',
    apiKey: 'sk-e2e-system-chat-key-4242',
    capabilities: { chat: true, tools: true, streaming: true, vision: true },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    userToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: userEmail, password, displayName: 'System Provider User' })
    ).body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, displayName: 'System Provider Admin' });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: UserRole.ADMIN } });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password })
    ).body.accessToken;
  });

  afterAll(async () => {
    await prisma.aiProvider.deleteMany({ where: { id: { in: createdSystemIds } } });
    await prisma.user.deleteMany({ where: { email: { in: [userEmail, adminEmail] } } });
    await app.close();
  });

  it('a standard user has no provider at all before anything is configured', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.chatConfigured).toBe(false);
    expect(res.body.sources.chat).toBe('none');
  });

  it('rejects SYSTEM provider creation for a non-admin (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers/system')
      .set('Authorization', `Bearer ${userToken}`)
      .send(systemChatDto);

    expect(res.status).toBe(403);
  });

  let systemChatId: string;
  it('lets an ADMIN create a SYSTEM chat provider (key encrypted, never returned)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers/system')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(systemChatDto);

    expect(res.status).toBe(201);
    systemChatId = res.body.id;
    createdSystemIds.push(systemChatId);

    expect(res.body.isSystem).toBe(true);
    expect(res.body.owner).toBe('system');
    expect(res.body.hasKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(systemChatDto.apiKey);

    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id: systemChatId } });
    expect(row.userId).toBeNull();
    expect(row.apiKeyEncrypted).not.toContain('sk-e2e-system');
  });

  it('a user with no provider of their own now resolves the SYSTEM one (source=system)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.body.chatConfigured).toBe(true);
    expect(res.body.sources.chat).toBe('system');
    expect(res.body.defaults.chat).toMatchObject({ id: systemChatId, source: 'system' });
  });

  it('exposes the SYSTEM provider read-only to the user, without the key hint', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${userToken}`);
    const system = list.body.find((p: { id: string }) => p.id === systemChatId);
    expect(system).toBeDefined();
    expect(system.isSystem).toBe(true);
    expect(system.keyHint).toBeNull();

    const one = await request(app.getHttpServer())
      .get(`/api/v1/ai-providers/${systemChatId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(one.status).toBe(200);
    expect(one.body.keyHint).toBeNull();
  });

  it('forbids a non-admin from updating, disabling, deleting or testing a SYSTEM provider', async () => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${userToken}`);

    expect((await auth(request(server).patch(`/api/v1/ai-providers/${systemChatId}`)).send({ name: 'hijacked' })).status).toBe(403);
    expect((await auth(request(server).post(`/api/v1/ai-providers/${systemChatId}/disable`))).status).toBe(403);
    expect((await auth(request(server).post(`/api/v1/ai-providers/${systemChatId}/test`))).status).toBe(403);
    expect((await auth(request(server).delete(`/api/v1/ai-providers/${systemChatId}`))).status).toBe(403);

    expect((await auth(request(server).get('/api/v1/ai-providers/system'))).status).toBe(403);
    expect((await auth(request(server).patch(`/api/v1/ai-providers/system/${systemChatId}`)).send({ name: 'x' })).status).toBe(403);
    expect((await auth(request(server).delete(`/api/v1/ai-providers/system/${systemChatId}`))).status).toBe(403);

    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id: systemChatId } });
    expect(row.name).toBe(systemChatDto.name);
    expect(row.isActive).toBe(true);
  });

  it('lets a SYSTEM provider serve Vision and Voice status for a user with no provider', async () => {
    const vision = await request(app.getHttpServer())
      .get('/api/v1/vision/status?scope=personal&space=default')
      .set('Authorization', `Bearer ${userToken}`);
    expect(vision.status).toBe(200);
    // Resolved through the SYSTEM chat provider, which declares vision support.
    expect(vision.body.visionConfigured).toBe(true);

    const voice = await request(app.getHttpServer())
      .get('/api/v1/voice/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(voice.status).toBe(200);
    // STT/TTS reuse the OpenAI chat credentials when no dedicated row exists.
    expect(voice.body.sttConfigured).toBe(true);
    expect(voice.body.ttsConfigured).toBe(true);
  });

  let systemEmbeddingId: string;
  it('resolves a SYSTEM embedding provider too', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers/system')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Mora Embeddings (system)',
        provider: 'openai',
        kind: 'embedding',
        model: 'text-embedding-3-small',
        apiKey: 'sk-e2e-system-embedding-key-4242',
        capabilities: { embeddings: true, dimensions: 1536 },
      });
    expect(res.status).toBe(201);
    systemEmbeddingId = res.body.id;
    createdSystemIds.push(systemEmbeddingId);

    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.embeddingConfigured).toBe(true);
    expect(status.body.sources.embedding).toBe('system');
  });

  let userProviderId: string;
  it('a personal (BYOK) provider overrides the SYSTEM one (source=user)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'My own OpenAI',
        provider: 'openai',
        kind: 'chat',
        model: 'gpt-4o',
        apiKey: 'sk-e2e-byok-key-9999',
      });
    expect(res.status).toBe(201);
    userProviderId = res.body.id;
    expect(res.body.isSystem).toBe(false);
    expect(res.body.owner).toBe('user');

    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.sources.chat).toBe('user');
    expect(status.body.defaults.chat).toMatchObject({ id: userProviderId, source: 'user' });
  });

  it('a scoped SYSTEM provider stays behind any matching personal provider', async () => {
    const scoped = await request(app.getHttpServer())
      .post('/api/v1/ai-providers/system')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Mora Chat pro (system)',
        provider: 'openai',
        kind: 'chat',
        model: 'gpt-4o-mini',
        apiKey: 'sk-e2e-system-scoped-key-4242',
        scope: 'professional',
        space: 'logistiga',
      });
    expect(scoped.status).toBe(201);
    createdSystemIds.push(scoped.body.id);

    // The user's global personal provider still wins over a more specific
    // SYSTEM row: ownership is checked before specificity.
    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.defaults.chat).toMatchObject({ id: userProviderId, source: 'user' });
  });

  it('falls back to SYSTEM again once the personal provider is removed', async () => {
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/${userProviderId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(del.status).toBe(204);

    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.sources.chat).toBe('system');
  });

  it('lets an ADMIN disable a SYSTEM provider, which stops resolving for users', async () => {
    const disabled = await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/system/${systemChatId}/disable`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(disabled.status).toBe(201);
    expect(disabled.body.isActive).toBe(false);

    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    // The scoped SYSTEM chat row is still active but only matches
    // professional/logistiga, so a global lookup finds nothing.
    expect(status.body.sources.chat).toBe('none');
    expect(status.body.chatConfigured).toBe(false);

    const reenabled = await request(app.getHttpServer())
      .post(`/api/v1/ai-providers/system/${systemChatId}/enable`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reenabled.status).toBe(201);
    expect(reenabled.body.isActive).toBe(true);
  });

  it('lets an ADMIN list, update and delete SYSTEM providers (key hint visible to admin only)', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/system')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.every((p: { isSystem: boolean }) => p.isSystem)).toBe(true);
    expect(list.body.find((p: { id: string }) => p.id === systemChatId).keyHint).toBe('4242');

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/ai-providers/system/${systemEmbeddingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Mora Embeddings v2 (system)' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Mora Embeddings v2 (system)');

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/system/${systemEmbeddingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);

    const status = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.embeddingConfigured).toBe(false);
    expect(status.body.sources.embedding).toBe('none');
  });

  it('refuses to manage a personal provider through the SYSTEM admin routes', async () => {
    const personal = await request(app.getHttpServer())
      .post('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Personal', provider: 'ollama', kind: 'chat', model: 'llama3' });
    expect(personal.status).toBe(201);

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/ai-providers/system/${personal.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});
