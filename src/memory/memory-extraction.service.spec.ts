import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryExtractionService } from './memory-extraction.service.js';

function buildService() {
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
  const memoryServiceMock = {
    findSupersessionCandidate: vi.fn(async (): Promise<{ id: string } | null> => null),
    create: vi.fn(async () => ({ id: 'created-1' })),
    supersede: vi.fn(async () => ({ old: { id: 'old' }, replacement: { id: 'new' } })),
  };
  const entitiesServiceMock = { findOrCreate: vi.fn(async () => ({ id: 'entity-1' })) };
  const prismaMock = { memoryEntity: { upsert: vi.fn() } };

  const service = new MemoryExtractionService(
    llmServiceMock as never,
    memoryServiceMock as never,
    entitiesServiceMock as never,
    prismaMock as never,
  );

  return { service, llmServiceMock, memoryServiceMock, entitiesServiceMock, prismaMock };
}

describe('MemoryExtractionService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  describe('isWorthConsidering', () => {
    it('rejects trivial greetings/confirmations', () => {
      expect(ctx.service.isWorthConsidering('Bonjour')).toBe(false);
      expect(ctx.service.isWorthConsidering('Merci')).toBe(false);
      expect(ctx.service.isWorthConsidering('Ok')).toBe(false);
      expect(ctx.service.isWorthConsidering("D'accord")).toBe(false);
    });

    it('rejects very short messages', () => {
      expect(ctx.service.isWorthConsidering('oui super')).toBe(false);
    });

    it('accepts a substantive message', () => {
      expect(
        ctx.service.isWorthConsidering(
          'Je préfère recevoir mes rappels importants de façon courte et directe',
        ),
      ).toBe(true);
    });
  });

  describe('proposeCandidates', () => {
    it('never calls the LLM for trivial input', async () => {
      const result = await ctx.service.proposeCandidates('Merci', 'De rien', { userId: 'u1' });
      expect(result).toEqual([]);
      expect(ctx.llmServiceMock.complete).not.toHaveBeenCalled();
    });

    it('returns no candidates when no LLM is configured, without throwing', async () => {
      const result = await ctx.service.proposeCandidates(
        'Je préfère recevoir mes rappels de façon courte et directe',
        'Compris, je serai bref.',
        { userId: 'u1' },
      );
      expect(result).toEqual([]);
    });

    it('parses valid JSON candidates from a configured LLM', async () => {
      ctx.llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: JSON.stringify([
          { kind: 'preference', content: 'Préfère les rappels courts', importance: 0.7, confidence: 0.8 },
        ]),
        provider: 'test',
        model: 'test-model',
      });

      const result = await ctx.service.proposeCandidates(
        'Je préfère recevoir mes rappels de façon courte et directe',
        'Compris.',
        { userId: 'u1', scope: 'personal', space: 'personal' },
      );

      expect(ctx.llmServiceMock.complete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'u1', scope: 'personal', space: 'personal' }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('preference');
    });

    it('returns no candidates when the LLM output is not valid JSON', async () => {
      ctx.llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: 'not json at all',
        provider: 'test',
        model: 'test-model',
      });

      const result = await ctx.service.proposeCandidates(
        'Je préfère recevoir mes rappels de façon courte et directe',
        'Compris.',
        { userId: 'u1' },
      );

      expect(result).toEqual([]);
    });

    it('drops malformed candidate entries but keeps valid ones', async () => {
      ctx.llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: JSON.stringify([
          { kind: 'not-a-real-kind', content: 'x' },
          { kind: 'fact', content: 'Le client paie à 30 jours' },
        ]),
        provider: 'test',
        model: 'test-model',
      });

      const result = await ctx.service.proposeCandidates(
        'Voici une information durable sur le client',
        'Compris.',
        { userId: 'u1' },
      );

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('fact');
    });
  });

  describe('commitCandidates', () => {
    it('creates a new memory when nothing similar exists', async () => {
      ctx.memoryServiceMock.findSupersessionCandidate.mockResolvedValue(null);

      await ctx.service.commitCandidates({
        userId: 'u1',
        scope: 'personal',
        space: 'personal',
        sourceMessageId: 'msg1',
        candidates: [{ kind: 'preference', content: 'Préfère les rappels courts', importance: 0.7, confidence: 0.8 }],
      });

      expect(ctx.memoryServiceMock.create).toHaveBeenCalledOnce();
      expect(ctx.memoryServiceMock.supersede).not.toHaveBeenCalled();
    });

    it('supersedes an existing similar memory instead of duplicating it', async () => {
      ctx.memoryServiceMock.findSupersessionCandidate.mockResolvedValue({ id: 'old-memory' });

      await ctx.service.commitCandidates({
        userId: 'u1',
        scope: 'personal',
        space: 'personal',
        sourceMessageId: 'msg1',
        candidates: [{ kind: 'preference', content: 'Préfère les rappels courts', importance: 0.7, confidence: 0.8 }],
      });

      expect(ctx.memoryServiceMock.supersede).toHaveBeenCalledWith(
        'u1',
        'old-memory',
        expect.objectContaining({ content: 'Préfère les rappels courts' }),
        'extraction',
        'msg1',
      );
      expect(ctx.memoryServiceMock.create).not.toHaveBeenCalled();
    });

    it('links a person/company candidate to an Entity', async () => {
      ctx.memoryServiceMock.findSupersessionCandidate.mockResolvedValue(null);
      ctx.memoryServiceMock.create.mockResolvedValue({ id: 'mem-1' });

      await ctx.service.commitCandidates({
        userId: 'u1',
        scope: 'professional',
        space: 'logistiga',
        sourceMessageId: 'msg1',
        candidates: [{ kind: 'company', content: 'Logistiga', importance: 0.6, confidence: 0.9 }],
      });

      expect(ctx.entitiesServiceMock.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'company', name: 'Logistiga' }),
      );
      expect(ctx.prismaMock.memoryEntity.upsert).toHaveBeenCalledOnce();
    });

    it('does not create an Entity for a non-person/company kind', async () => {
      ctx.memoryServiceMock.findSupersessionCandidate.mockResolvedValue(null);
      ctx.memoryServiceMock.create.mockResolvedValue({ id: 'mem-2' });

      await ctx.service.commitCandidates({
        userId: 'u1',
        scope: 'personal',
        space: 'personal',
        sourceMessageId: 'msg1',
        candidates: [{ kind: 'habit', content: 'Se lève tôt', importance: 0.5, confidence: 0.6 }],
      });

      expect(ctx.entitiesServiceMock.findOrCreate).not.toHaveBeenCalled();
    });
  });
});
