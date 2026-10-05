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

describe('Remote MCP endpoint (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-mcp-${randomUUID()}@example.com`;
  let key: string;

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
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-strong-password', displayName: 'E2E MCP' });
    const created = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name: 'mcp e2e' });
    key = created.body.key;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('refuses an unauthenticated call', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  it('answers initialize and tools/list to a valid API key', async () => {
    const init = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('X-Api-Key', key)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('mora');

    const list = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('X-Api-Key', key)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.body.result.tools).toHaveLength(4);
  });

  it('returns the calling user own conversations (empty for a new user)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('X-Api-Key', key)
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whatsapp_list_conversations', arguments: {} } });
    expect(res.body.result.isError).toBeFalsy();
    expect(res.body.result.content[0].text).toBe('[]');
  });

  it('accepts the key as the URL path segment for header-less connectors', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/mcp/${key}`)
      .send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.body.result.tools).toHaveLength(4);
  });

  it('refuses a wrong key in the URL path', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/mcp/mora_not-a-real-key-000000000000')
      .send({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  it('refuses a send without confirmation through the real endpoint', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('X-Api-Key', key)
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'whatsapp_send_message', arguments: { conversationId: randomUUID(), text: 'x', confirm: false } },
      });
    expect(res.body.result.isError).toBe(true);
  });
});
