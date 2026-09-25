import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { VisionAnalysisService } from '../src/vision/vision-analysis.service.js';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);
const PNG_1X1_ALT = Buffer.from(PNG_1X1);
PNG_1X1_ALT[PNG_1X1_ALT.length - 1] = 0x81;

describe('Vision (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  const email = `e2e-vision-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VisionAnalysisService)
      .useValue({
        analyzeImage: async () => ({
          summary: 'Une capture montre un tableau PostgreSQL.',
          extractedText: 'PostgreSQL',
          structuredData: { topic: 'postgresql' },
          provider: 'mock',
          model: 'mock-vision',
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', displayName: 'Vision E2E' });
    token = register.body.accessToken;
    userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  });

  afterAll(async () => {
    await prisma.visionAsset.deleteMany({ where: { userId } });
    await prisma.message.deleteMany({ where: { conversation: { userId } } });
    await prisma.conversation.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('stores vision assets, preserves the conversation, and annotates the originating user message metadata', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/vision/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('message', 'Parle-moi de cette capture.')
      .field('scope', 'professional')
      .field('space', 'code')
      .field('sourceType', 'screenshot')
      .attach('files', PNG_1X1, { filename: 'capture.png', contentType: 'image/png' });

    expect(first.status).toBe(201);
    expect(first.body.conversationId).toBeTypeOf('string');
    expect(first.body.userMessageId).toBeTypeOf('string');
    expect(first.body.assets).toHaveLength(1);

    const second = await request(app.getHttpServer())
      .post('/api/v1/vision/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('message', 'Et sur celle-ci ?')
      .field('scope', 'professional')
      .field('space', 'code')
      .field('conversationId', first.body.conversationId)
      .attach('files', PNG_1X1_ALT, { filename: 'capture-2.png', contentType: 'image/png' });

    expect(second.status).toBe(201);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    const persistedMessage = await prisma.message.findUniqueOrThrow({ where: { id: first.body.userMessageId } });
    const metadata = persistedMessage.metadata as Record<string, unknown>;
    expect(metadata.channel).toBe('vision');
    expect(metadata.visionAssetIds).toEqual([first.body.assets[0].id]);
    expect(String(metadata.visionContextSummary)).toContain('Contexte visuel attache a cette demande');

    const persistedAsset = await prisma.visionAsset.findUniqueOrThrow({ where: { id: first.body.assets[0].id } });
    expect(persistedAsset.conversationId).toBe(first.body.conversationId);
    expect(persistedAsset.messageId).toBe(first.body.userMessageId);
    expect(persistedAsset.status).toBe('analyzed');

    const fetchedAsset = await request(app.getHttpServer())
      .get(`/api/v1/vision/assets/${first.body.assets[0].id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetchedAsset.status).toBe(200);
    expect(fetchedAsset.body.id).toBe(first.body.assets[0].id);
    expect(fetchedAsset.body.conversationId).toBe(first.body.conversationId);
    expect(fetchedAsset.body.storageKey).toBeUndefined();
    expect(fetchedAsset.body.storageProvider).toBeUndefined();
    expect(fetchedAsset.body.checksum).toBeUndefined();
  });
});
