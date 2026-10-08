import { describe, expect, it, vi } from 'vitest';
import { MemoryEmbeddingProcessor } from './memory-embedding.processor.js';

function buildProcessor() {
  const prismaMock = { memory: { findUnique: vi.fn() } };
  const embeddingServiceMock = { embed: vi.fn() };
  const embeddingRepositoryMock = { setEmbedding: vi.fn() };

  const processor = new MemoryEmbeddingProcessor(
    prismaMock as never,
    embeddingServiceMock as never,
    embeddingRepositoryMock as never,
  );
  return { processor, prismaMock, embeddingServiceMock, embeddingRepositoryMock };
}

const job = { data: { memoryId: 'm1', userId: 'u1' } } as never;

describe('MemoryEmbeddingProcessor', () => {
  it('skips without throwing when the memory no longer exists or belongs to another user', async () => {
    const { processor, prismaMock } = buildProcessor();
    prismaMock.memory.findUnique.mockResolvedValue(null);

    const result = await processor.process(job);
    expect(result).toEqual({ embedded: false, reason: 'memory_not_found' });
  });

  it('skips without throwing when no embedding provider is configured', async () => {
    const { processor, prismaMock, embeddingServiceMock } = buildProcessor();
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', content: 'hi', scope: 'personal' });
    embeddingServiceMock.embed.mockResolvedValue({ enabled: false });

    const result = await processor.process(job);
    expect(result).toEqual({ embedded: false, reason: 'not_configured' });
  });

  it('throws so BullMQ retries when a configured provider fails (not a permanent state)', async () => {
    const { processor, prismaMock, embeddingServiceMock } = buildProcessor();
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', content: 'hi', scope: 'personal' });
    embeddingServiceMock.embed.mockResolvedValue({ enabled: true, embedding: null, error: 'timeout' });

    await expect(processor.process(job)).rejects.toThrow(/embedding_provider_failed/);
  });

  it('persists the embedding and reports success on a real result', async () => {
    const { processor, prismaMock, embeddingServiceMock, embeddingRepositoryMock } = buildProcessor();
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', content: 'hi', scope: 'personal' });
    embeddingServiceMock.embed.mockResolvedValue({
      enabled: true,
      embedding: [0.1, 0.2],
      dimensions: 2,
      model: 'test-model',
    });

    const result = await processor.process(job);
    expect(result).toEqual({ embedded: true });
    expect(embeddingRepositoryMock.setEmbedding).toHaveBeenCalledWith({
      memoryId: 'm1',
      userId: 'u1',
      embedding: [0.1, 0.2],
      model: 'test-model',
      dimensions: 2,
    });
  });
});
