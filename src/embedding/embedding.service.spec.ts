import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProviderInterface } from './embedding-provider.interface.js';
import { EmbeddingService } from './embedding.service.js';

describe('EmbeddingService', () => {
  let providerMock: {
    name: string;
    isConfigured: ReturnType<typeof vi.fn>;
    embed: ReturnType<typeof vi.fn>;
  };
  let service: EmbeddingService;

  beforeEach(() => {
    providerMock = {
      name: 'test-embedding-provider',
      isConfigured: vi.fn(() => false),
      embed: vi.fn(),
    };
    service = new EmbeddingService(providerMock as unknown as EmbeddingProviderInterface);
  });

  it('never throws and returns a disabled outcome when the provider is not configured', async () => {
    providerMock.isConfigured.mockReturnValue(false);

    const result = await service.embed('some text');

    expect(result.enabled).toBe(false);
    expect(result.embedding).toBeNull();
    expect(providerMock.embed).not.toHaveBeenCalled();
  });

  it('measures the real dimension rather than assuming a fixed size', async () => {
    providerMock.isConfigured.mockReturnValue(true);
    providerMock.embed.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      model: 'test-model',
      dimensions: 5,
    });

    const result = await service.embed('some text');

    expect(result.enabled).toBe(true);
    expect(result.dimensions).toBe(5);
    expect(result.embedding).toHaveLength(5);
  });

  it('degrades gracefully (never throws) when a configured provider fails', async () => {
    providerMock.isConfigured.mockReturnValue(true);
    providerMock.embed.mockRejectedValue(new Error('provider outage'));

    const result = await service.embed('some text');

    expect(result.enabled).toBe(true);
    expect(result.embedding).toBeNull();
    expect(result.error).toMatch(/provider outage/);
  });
});
