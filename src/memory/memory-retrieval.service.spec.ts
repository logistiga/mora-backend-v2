import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRetrievalService } from './memory-retrieval.service.js';

function buildService() {
  const prismaMock = { memory: { findMany: vi.fn() } };
  const embeddingServiceMock = { embed: vi.fn() };
  const embeddingRepositoryMock = { searchSimilar: vi.fn() };
  const memoryServiceMock = { recordAccess: vi.fn() };
  const configServiceMock = { get: vi.fn(() => 8) };

  const service = new MemoryRetrievalService(
    prismaMock as never,
    embeddingServiceMock as never,
    embeddingRepositoryMock as never,
    memoryServiceMock as never,
    configServiceMock as never,
  );

  return { service, prismaMock, embeddingServiceMock, embeddingRepositoryMock, memoryServiceMock };
}

describe('MemoryRetrievalService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('uses semantic search when embeddings are enabled and matches exist', async () => {
    ctx.embeddingServiceMock.embed.mockResolvedValue({
      enabled: true,
      embedding: [0.1, 0.2],
      model: 'test-model',
      dimensions: 2,
    });
    ctx.embeddingRepositoryMock.searchSimilar.mockResolvedValue([
      {
        id: 'm1',
        content: 'Préfère les rappels courts',
        kind: 'preference',
        importance: 0.8,
        confidence: 0.7,
        accessCount: 2,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
        similarity: 0.92,
      },
    ]);

    const result = await ctx.service.retrieve({
      userId: 'u1',
      scope: 'personal',
      space: 'personal',
      queryText: 'Comment aime-t-il ses notifications ?',
    });

    expect(result.mode).toBe('semantic');
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].mode).toBe('semantic');
    expect(ctx.memoryServiceMock.recordAccess).toHaveBeenCalledWith(['m1']);
  });

  it('falls back to text search when embeddings are disabled', async () => {
    ctx.embeddingServiceMock.embed.mockResolvedValue({
      enabled: false,
      embedding: null,
      model: null,
      dimensions: null,
    });
    ctx.prismaMock.memory.findMany.mockResolvedValue([
      {
        id: 'm2',
        content: 'Le client Logistiga paie à 30 jours',
        kind: 'fact',
        importance: 0.6,
        confidence: 0.9,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: new Date(),
      },
    ]);

    const result = await ctx.service.retrieve({
      userId: 'u1',
      scope: 'professional',
      space: 'logistiga',
      queryText: 'Logistiga paiement délai',
    });

    expect(ctx.embeddingRepositoryMock.searchSimilar).not.toHaveBeenCalled();
    expect(result.mode).toBe('text');
    expect(result.memories[0].mode).toBe('text');
  });

  it('falls back to text search when the embedding provider errors', async () => {
    ctx.embeddingServiceMock.embed.mockResolvedValue({
      enabled: true,
      embedding: null,
      model: null,
      dimensions: null,
      error: 'provider outage',
    });
    ctx.prismaMock.memory.findMany.mockResolvedValue([]);

    const result = await ctx.service.retrieve({
      userId: 'u1',
      scope: 'personal',
      space: 'personal',
      queryText: 'rappels courts',
    });

    expect(ctx.embeddingRepositoryMock.searchSimilar).not.toHaveBeenCalled();
    expect(result.mode).toBe('none');
    expect(result.embeddingError).toBe('provider outage');
  });

  it('falls back to text search when semantic search finds nothing embedded yet', async () => {
    ctx.embeddingServiceMock.embed.mockResolvedValue({
      enabled: true,
      embedding: [0.1, 0.2],
      model: 'test-model',
      dimensions: 2,
    });
    ctx.embeddingRepositoryMock.searchSimilar.mockResolvedValue([]);
    ctx.prismaMock.memory.findMany.mockResolvedValue([]);

    const result = await ctx.service.retrieve({
      userId: 'u1',
      scope: 'personal',
      space: 'personal',
      queryText: 'rappels courts',
    });

    expect(result.mode).toBe('none');
  });

  it('limits results to the configured limit', async () => {
    ctx.embeddingServiceMock.embed.mockResolvedValue({ enabled: false, embedding: null, model: null, dimensions: null });
    ctx.prismaMock.memory.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        content: `souvenir personnel numero ${i}`,
        kind: 'fact',
        importance: 0.5,
        confidence: 0.5,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: new Date(),
      })),
    );

    const result = await ctx.service.retrieve({
      userId: 'u1',
      scope: 'personal',
      space: 'personal',
      queryText: 'souvenir personnel',
      limit: 3,
    });

    expect(result.memories.length).toBeLessThanOrEqual(3);
  });
});
