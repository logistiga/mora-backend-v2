import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { ConversationsService } from '../src/conversations/conversations.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OpenAiCompatibleProvider } from '../src/llm/providers/openai-compatible.provider.js';

/**
 * Requires a running PostgreSQL (migrated) + Redis reachable via `.env.test`.
 * No LLM provider is configured in `.env.test`, so this suite exercises the
 * real "not configured" degraded path for personal/professional/hybrid.
 */
describe('Messages (e2e) — no LLM configured', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-messages-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Messages' });
    accessToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('rejects POST /messages without a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .send({ message: 'Bonjour' });
    expect(res.status).toBe(401);
  });

  it('routes a greeting as direct without needing an LLM', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Bonjour Mora' });

    expect(res.status).toBe(201);
    expect(res.body.route).toBe('direct');
    expect(res.body.scope).toBe('direct');
    expect(res.body.space).toBe('direct');
    expect(res.body.response).toMatch(/bonjour/i);
    expect(res.body.conversationId).toBeTypeOf('string');
    expect(res.body.messageId).toBeTypeOf('string');
  });

  it('routes a personal message and degrades gracefully with no LLM configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi le rendez-vous de ma fille demain' });

    expect(res.status).toBe(201);
    expect(res.body.route).toBe('personal');
    expect(res.body.scope).toBe('personal');
    expect(res.body.response).toMatch(/configuration llm manquante/i);
  });

  it.each([
    ['Vérifie le statut de la commande Logistiga', 'logistiga'],
    ['Le planning du projet Piston doit être mis à jour', 'piston'],
    ['Il y a un bug dans le code TypeScript de l\'API', 'code'],
  ])('routes "%s" as professional/%s', async (message, expectedSpace) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message });

    expect(res.status).toBe(201);
    expect(res.body.route).toBe('professional');
    expect(res.body.space).toBe(expectedSpace);
  });

  it('blocks a hybrid message by default (cross-scope disabled)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi mon rendez-vous perso et vérifie aussi le client Logistiga' });

    expect(res.status).toBe(201);
    expect(res.body.route).toBe('hybrid');
    expect(res.body.response).toMatch(/cross-scope est désactivé/i);
  });

  it('reuses the same conversation when conversationId is passed, creates a new one otherwise', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Bonjour' });
    const conversationId = first.body.conversationId;

    const second = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Bonjour encore', conversationId });

    expect(second.body.conversationId).toBe(conversationId);

    const third = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Bonjour' });
    expect(third.body.conversationId).not.toBe(conversationId);
  });

  it('rejects an unknown conversationId', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Bonjour', conversationId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('persists the user + assistant messages and the router decision', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Vérifie le client Logistiga' });
    const { conversationId } = created.body;

    const conv = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(conv.status).toBe(200);
    expect(conv.body.messages).toHaveLength(2);
    expect(conv.body.messages[0].role).toBe('USER');
    expect(conv.body.messages[1].role).toBe('ASSISTANT');
    expect(conv.body.messages[0].space).toBe('logistiga');

    const decisions = await request(app.getHttpServer())
      .get('/api/v1/router-decisions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(decisions.status).toBe(200);
    const matching = decisions.body.find((d: { conversationId: string }) => d.conversationId === conversationId);
    expect(matching).toBeDefined();
    expect(matching.route).toBe('professional');
    expect(matching.space).toBe('logistiga');
  });

  it('lists only the current user\'s conversations', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('conversations/router-decisions endpoints require auth', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/conversations');
    const b = await request(app.getHttpServer()).get('/api/v1/router-decisions');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
  });

  it('never leaks personal content into professional history, or vice versa', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Mon secret personnel : rendez-vous chez le médecin de ma fille' });
    const { conversationId } = created.body;

    await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Vérifie le client Logistiga', conversationId });

    const conversationsService = app.get(ConversationsService);
    const personalHistory = await conversationsService.getScopedHistory(conversationId, 'personal');
    const professionalHistory = await conversationsService.getScopedHistory(
      conversationId,
      'professional',
    );

    expect(personalHistory.some((m) => m.content.includes('Logistiga'))).toBe(false);
    expect(professionalHistory.some((m) => m.content.includes('médecin'))).toBe(false);
  });
});

describe('Messages (e2e) — LLM provider mocked', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-messages-llm-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue({
        name: 'openai-compatible',
        isConfigured: () => true,
        complete: async () => ({
          content: 'Réponse simulée du LLM.',
          provider: 'openai-compatible',
          model: 'mock-model',
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E LLM' });
    accessToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns the mocked LLM response for a personal message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Rappelle-moi le rendez-vous de ma fille demain' });

    expect(res.status).toBe(201);
    expect(res.body.response).toBe('Réponse simulée du LLM.');
  });

  it('returns the mocked LLM response for a professional message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Vérifie le client Logistiga' });

    expect(res.status).toBe(201);
    expect(res.body.response).toBe('Réponse simulée du LLM.');
  });
});
