import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LLM_PROVIDER, type LlmCompletionResult } from '../src/llm/llm-provider.interface.js';
import { ToolExecutorService } from '../src/tools/tool-executor.service.js';
import { ToolRegistryService } from '../src/tools/tool-registry.service.js';
import { SKILL_CATALOG, skillKeyForTool } from '../src/skills/skill-catalog.js';

const silentLlm = {
  isConfigured: () => false,
  complete: async (): Promise<LlmCompletionResult> => ({ content: '', provider: 'none', model: 'none' }),
};

describe('Skills registry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: ToolExecutorService;
  let registry: ToolRegistryService;
  const email = `e2e-skills-${randomUUID()}@example.com`;
  const otherEmail = `e2e-skills-other-${randomUUID()}@example.com`;
  const password = 'a-strong-password';
  let accessToken: string;
  let userId: string;
  let otherAccessToken: string;
  let otherUserId: string;

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
    executor = app.get(ToolExecutorService);
    registry = app.get(ToolRegistryService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Skills' });
    accessToken = res.body.accessToken;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    const other = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: otherEmail, password, displayName: 'E2E Skills Other' });
    otherAccessToken = other.body.accessToken;
    otherUserId = (await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  it('covers every tool actually registered at runtime by exactly one skill (catalog completeness guard)', () => {
    const uncovered = registry
      .list()
      .map((tool) => tool.name)
      .filter((name) => skillKeyForTool(name) === null);
    expect(uncovered).toEqual([]);
    expect(SKILL_CATALOG.flatMap((s) => s.toolNames)).toHaveLength(registry.list().length);
  });

  it('requires authentication on the skills endpoints', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/skills');
    expect(res.status).toBe(401);
  });

  it('lists every catalog skill as enabled for a fresh user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/skills')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(SKILL_CATALOG.length);
    expect(res.body.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
  });

  it('disables a skill and persists it across requests', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/api/v1/skills/whatsapp')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);

    const list = await request(app.getHttpServer())
      .get('/api/v1/skills')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.body.find((s: { key: string }) => s.key === 'whatsapp').enabled).toBe(false);
  });

  it('rejects an unknown skill key and an invalid body', async () => {
    const unknown = await request(app.getHttpServer())
      .patch('/api/v1/skills/spotify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: true });
    expect(unknown.status).toBe(404);

    const invalid = await request(app.getHttpServer())
      .patch('/api/v1/skills/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: 'yes' });
    expect(invalid.status).toBe(400);

    const stringFalse = await request(app.getHttpServer())
      .patch('/api/v1/skills/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: 'false' });
    expect(stringFalse.status).toBe(400);
  });

  it('never leaks one user\'s disabled skill to another user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/skills')
      .set('Authorization', `Bearer ${otherAccessToken}`);
    expect(res.body.find((s: { key: string }) => s.key === 'whatsapp').enabled).toBe(true);
    expect(otherUserId).not.toBe(userId);
  });

  it('blocks execution of a tool whose skill is disabled, with a skill_disabled reason', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/skills/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: false });

    const outcome = await executor.requestExecution(
      'create_task',
      { title: 'Tâche bloquée' },
      { userId, scope: 'personal', space: 'personal', route: 'personal' },
    );
    expect(outcome).toEqual({ kind: 'rejected', reason: 'skill_disabled' });
  });

  it('allows the same tool again once its skill is re-enabled, and the other user is unaffected', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/skills/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ enabled: true });

    const outcome = await executor.requestExecution(
      'create_task',
      { title: 'Tâche autorisée' },
      { userId, scope: 'personal', space: 'personal', route: 'personal' },
    );
    expect(outcome.kind).not.toBe('rejected');

    const otherOutcome = await executor.requestExecution(
      'create_task',
      { title: 'Autre utilisateur' },
      { userId: otherUserId, scope: 'personal', space: 'personal', route: 'personal' },
    );
    expect(otherOutcome.kind).not.toBe('rejected');
  });
});
