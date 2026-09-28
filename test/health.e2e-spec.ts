import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

/**
 * Requires a running PostgreSQL + Redis (e.g. `docker compose up -d mora-postgres mora-redis`)
 * reachable via the values in `.env.test`.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 and reports postgres + redis up', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.details.postgres.status).toBe('up');
    expect(response.body.details.redis.status).toBe('up');
    expect(response.body.environment).toBeDefined();
    expect(response.body.version).toBeDefined();
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  describe('X-Request-Id', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    it('keeps a safe client request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'client-trace_01.a:b');
      expect(response.headers['x-request-id']).toBe('client-trace_01.a:b');
    });

    it.each([
      ['too long', 'x'.repeat(600)],
      ['html/script', '<script>alert(1)</script>'],
    ])('replaces an unsafe client request id (%s) with a server UUID', async (_label, value) => {
      const response = await request(app.getHttpServer()).get('/api/v1/health').set('X-Request-Id', value);
      expect(response.headers['x-request-id']).toMatch(UUID);
      expect(JSON.stringify(response.headers)).not.toContain(value);
      expect(response.text).not.toContain(value);
    });

    it('never reflects an unsafe request id in an error body', async () => {
      const value = '<script>alert(1)</script>';
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('X-Request-Id', value);
      expect(response.status).toBe(401);
      expect(response.headers['x-request-id']).toMatch(UUID);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
      expect(response.text).not.toContain(value);
    });
  });
});
