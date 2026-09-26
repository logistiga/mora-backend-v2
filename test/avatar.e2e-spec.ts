import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Avatar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  const emailA = `e2e-avatar-a-${randomUUID()}@example.com`;
  const emailB = `e2e-avatar-b-${randomUUID()}@example.com`;
  const password = 'a-strong-password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    tokenA = (
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: emailA, password, displayName: 'Avatar A' })
    ).body.accessToken;
    tokenB = (
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: emailB, password, displayName: 'Avatar B' })
    ).body.accessToken;
  });

  afterAll(async () => {
    await prisma.avatarProfile.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await app.close();
  });

  it('creates a default profile on first read and reports avatar status/features', async () => {
    const profile = await request(app.getHttpServer()).get('/api/v1/avatar/profile').set('Authorization', `Bearer ${tokenA}`);
    expect(profile.status).toBe(200);
    expect(profile.body.renderMode).toBe('expressive_orb');
    expect(profile.body.lipSyncMode).toBe('viseme_timeline');

    const status = await request(app.getHttpServer()).get('/api/v1/avatar/status').set('Authorization', `Bearer ${tokenA}`);
    expect(status.status).toBe(200);
    expect(status.body.avatarConfigured).toBe(true);
    expect(status.body.features.lipSync).toBe(true);
    expect(status.body.realtime.events).toContain('avatar.state');
  });

  it('updates avatar preferences without leaking them across users', async () => {
    const updated = await request(app.getHttpServer())
      .patch('/api/v1/avatar/profile')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reducedMotion: true, renderMode: 'minimal', baseExpression: 'attentive' });

    expect(updated.status).toBe(200);
    expect(updated.body.reducedMotion).toBe(true);
    expect(updated.body.renderMode).toBe('minimal');

    const otherUser = await request(app.getHttpServer()).get('/api/v1/avatar/profile').set('Authorization', `Bearer ${tokenB}`);
    expect(otherUser.status).toBe(200);
    expect(otherUser.body.reducedMotion).toBe(false);
    expect(otherUser.body.renderMode).toBe('expressive_orb');
  });
});
