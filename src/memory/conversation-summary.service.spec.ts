import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationSummaryService } from './conversation-summary.service.js';

function buildService(threshold = 5) {
  const prismaMock = {
    conversationSummary: { findUnique: vi.fn(), upsert: vi.fn() },
    message: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  };
  const llmServiceMock = {
    isConfigured: vi.fn(() => false),
    complete: vi.fn(
      async (): Promise<{ configured: boolean; content: string; provider: string; model: string | null }> => ({
        configured: false,
        content: '',
        provider: 'none',
        model: null,
      }),
    ),
  };
  const configServiceMock = { get: vi.fn(() => threshold) };

  const service = new ConversationSummaryService(
    prismaMock as never,
    llmServiceMock as never,
    configServiceMock as never,
  );

  return { service, prismaMock, llmServiceMock };
}

describe('ConversationSummaryService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService(5);
  });

  describe('shouldSummarize', () => {
    it('is false for a short conversation (below threshold)', async () => {
      ctx.prismaMock.conversationSummary.findUnique.mockResolvedValue(null);
      ctx.prismaMock.message.count.mockResolvedValue(2);

      const result = await ctx.service.shouldSummarize('conv1', 'personal', 'personal');
      expect(result).toBe(false);
    });

    it('is true once enough unsummarized messages have accumulated', async () => {
      ctx.prismaMock.conversationSummary.findUnique.mockResolvedValue(null);
      ctx.prismaMock.message.count.mockResolvedValue(6);

      const result = await ctx.service.shouldSummarize('conv1', 'personal', 'personal');
      expect(result).toBe(true);
    });
  });

  describe('summarize', () => {
    it('does nothing (no LLM call) when there are no new messages', async () => {
      ctx.prismaMock.conversationSummary.findUnique.mockResolvedValue(null);
      ctx.prismaMock.message.findMany.mockResolvedValue([]);

      const result = await ctx.service.summarize('conv1', 'u1', 'personal', 'personal');

      expect(result).toBeNull();
      expect(ctx.llmServiceMock.complete).not.toHaveBeenCalled();
    });

    it('skips gracefully (returns existing summary) when no LLM is configured', async () => {
      const existing = { id: 's1', summary: 'ancien résumé' };
      ctx.prismaMock.conversationSummary.findUnique.mockResolvedValue(existing);
      ctx.prismaMock.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'bonjour', createdAt: new Date() },
      ]);
      // complete() is attempted (Phase C.5: availability may depend on this
      // user's own DB providers) but reports back "not configured".

      const result = await ctx.service.summarize('conv1', 'u1', 'personal', 'personal');

      expect(result).toBe(existing);
      expect(ctx.llmServiceMock.complete).toHaveBeenCalledOnce();
    });

    it('creates a new summary from scratch when none exists and an LLM is configured', async () => {
      ctx.prismaMock.conversationSummary.findUnique.mockResolvedValue(null);
      ctx.prismaMock.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'Je préfère les rappels courts', createdAt: new Date() },
        { id: 'm2', role: 'ASSISTANT', content: 'Compris.', createdAt: new Date() },
      ]);
      ctx.llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: "L'utilisateur préfère des rappels courts.",
        provider: 'test',
        model: 'test-model',
      });
      ctx.prismaMock.conversationSummary.upsert.mockResolvedValue({ id: 's1', summary: "L'utilisateur préfère des rappels courts." });

      const result = await ctx.service.summarize('conv1', 'u1', 'personal', 'personal');

      expect(ctx.prismaMock.conversationSummary.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId_scope_space: { conversationId: 'conv1', scope: 'personal', space: 'personal' } },
          create: expect.objectContaining({ fromMessageId: 'm1', toMessageId: 'm2', messageCount: 2 }),
        }),
      );
      expect(result?.summary).toMatch(/rappels courts/);
    });
  });
});
