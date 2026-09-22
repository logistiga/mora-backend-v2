import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Requires a running PostgreSQL (migrated) + Redis reachable via `.env.test`.
 * Uses a unique email per run so it is safe to re-run against a persistent DB.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'a-strong-password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('registers a new user and returns a token pair', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Test' });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeTypeOf('string');
    expect(response.body.refreshToken).toBeTypeOf('string');
  });

  it('rejects a duplicate registration', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'E2E Test' });

    expect(response.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTypeOf('string');
  });

  it('rejects login with a wrong password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('GET /users/me requires a bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(response.status).toBe(401);
  });

  it('GET /users/me returns the authenticated user with a valid access token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(email);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('rotates tokens via /auth/refresh', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTypeOf('string');
    expect(response.body.refreshToken).not.toBe(login.body.refreshToken);
  });
});
