import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';

describe('Bug Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let adminToken: string;
  let reportId: string;
  const userEmail = `e2e-bug-user-${randomUUID()}@example.com`;
  const adminEmail = `e2e-bug-admin-${randomUUID()}@example.com`;
  const password = 'a-strong-password';

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
        .send({ email: userEmail, password, displayName: 'Bug User' })
    ).body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, displayName: 'Bug Admin' });
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: UserRole.ADMIN },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password })
    ).body.accessToken;
  });

  afterAll(async () => {
    await prisma.bugReport.deleteMany({
      where: { user: { email: { in: [userEmail, adminEmail] } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: [userEmail, adminEmail] } } });
    await app.close();
  });

  it('creates a bug report, preserves requestId, and sanitizes metadata', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bug-reports')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Request-Id', 'req-bug-e2e-1')
      .send({
        category: 'avatar',
        severity: 'high',
        title: 'Avatar freeze',
        description: 'Avatar freeze after reconnect',
        metadata: {
          panel: 'voice',
          apiKey: 'sk-should-never-store',
          nested: { Authorization: 'Bearer abc.def.ghi', step: 'after reconnect' },
        },
      });

    expect(res.status).toBe(201);
    expect(res.headers['x-request-id']).toBe('req-bug-e2e-1');
    expect(res.body.requestId).toBe('req-bug-e2e-1');
    expect(res.body.metadata).toEqual({ panel: 'voice', nested: { step: 'after reconnect' } });
    reportId = res.body.id;
  });

  it('returns requestId in validation errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bug-reports')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Request-Id', 'req-bug-e2e-2')
      .send({ category: 'avatar' });

    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBe('req-bug-e2e-2');
    expect(res.body.requestId).toBe('req-bug-e2e-2');
  });

  it('allows an admin to list and update bug reports', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/bug-reports')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(list.status).toBe(200);
    expect(list.body.some((report: { id: string }) => report.id === reportId)).toBe(true);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/bug-reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'investigating' });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('investigating');
  });
});
