import { describe, expect, it, vi } from 'vitest';
import { VisionService } from './vision.service.js';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

describe('VisionService', () => {
  it('keeps the same conversation and injects vision context into the orchestrator turn', async () => {
    const conversationsService = { getOrCreateConversation: vi.fn(async () => ({ id: 'conv-1' })) };
    const usersService = { findById: vi.fn(async () => ({ id: 'u1', displayName: 'Omar' })) };
    const visionAssets = {
      getLimits: vi.fn(() => ({ maxUploadBytes: 10485760, maxFiles: 4 })),
      createOrReuse: vi.fn(async () => ({
        asset: {
          id: 'asset-1',
          status: 'analyzed',
          summary: 'Un tableau PostgreSQL est visible.',
          extractedText: 'PostgreSQL',
          analysis: { structuredData: { topic: 'postgresql' } },
          originalFilename: 'capture.png',
          width: 1,
          height: 1,
        },
      })),
      attachToMessage: vi.fn(async () => undefined),
    };
    const visionAnalysis = {};
    const visionResolver = { resolve: vi.fn(async () => null) };
    const orchestrator = {
      handleMessage: vi.fn(async () => ({
        conversationId: 'conv-1',
        userMessageId: 'msg-user-1',
        messageId: 'msg-assistant-1',
        response: 'Voici ce que je vois.',
        route: 'professional',
        scope: 'professional',
        space: 'code',
        confidence: 0.95,
      })),
    };
    const audit = { log: vi.fn(async () => undefined) };

    const service = new VisionService(
      conversationsService as never,
      usersService as never,
      visionAssets as never,
      visionAnalysis as never,
      visionResolver as never,
      orchestrator as never,
      audit as never,
    );

    const result = await service.analyze(
      { id: 'u1', email: 'user@example.com' } as never,
      { message: 'Parle-moi de cette capture PostgreSQL.', scope: 'professional', space: 'code' },
      [{ originalname: 'capture.png', buffer: PNG_1X1 }] as Express.Multer.File[],
    );

    expect(conversationsService.getOrCreateConversation).toHaveBeenCalledWith('u1', undefined);
    expect(orchestrator.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        channel: 'vision',
        routingOverride: { route: 'professional', scope: 'professional', space: 'code' },
        userMessageMetadata: expect.objectContaining({ channel: 'vision', visionAssetIds: ['asset-1'] }),
        externalContextNotes: [expect.stringContaining('Contexte visuel attache a cette demande')],
      }),
    );
    expect(visionAssets.attachToMessage).toHaveBeenCalledWith('u1', ['asset-1'], 'msg-user-1');
    expect(result.conversationId).toBe('conv-1');
    expect(result.assets).toHaveLength(1);
  });
});
