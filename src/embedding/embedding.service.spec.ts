import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProviderInterface } from './embedding-provider.interface.js';
import { EmbeddingService } from './embedding.service.js';

function buildService() {
  const providerMock = {
    name: 'test-embedding-provider',
    isConfigured: vi.fn(() => false),
    embed: vi.fn(),
  };
  const modelSelectorMock = {
    selectProvider: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  };
  const embeddingAdaptersMock = { getAdapter: vi.fn() };
  const callLoggerMock = { log: vi.fn() };

  const service = new EmbeddingService(
    providerMock as unknown as EmbeddingProviderInterface,
    modelSelectorMock as never,
    embeddingAdaptersMock as never,
    callLoggerMock as never,
  );

  return { service, providerMock, modelSelectorMock, embeddingAdaptersMock, callLoggerMock };
}

describe('EmbeddingService — env-configured fallback (no userId in context)', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('never throws and returns a disabled outcome when nothing is configured', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(false);

    const result = await ctx.service.embed('some text');

    expect(result.enabled).toBe(false);
    expect(result.embedding).toBeNull();
    expect(ctx.providerMock.embed).not.toHaveBeenCalled();
    expect(ctx.modelSelectorMock.selectProvider).not.toHaveBeenCalled();
  });

  it('measures the real dimension rather than assuming a fixed size', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(true);
    ctx.providerMock.embed.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      model: 'test-model',
      dimensions: 5,
    });

    const result = await ctx.service.embed('some text');

    expect(result.enabled).toBe(true);
    expect(result.dimensions).toBe(5);
  });

  it('degrades gracefully (never throws) when the env-configured provider fails', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(true);
    ctx.providerMock.embed.mockRejectedValue(new Error('provider outage'));

    const result = await ctx.service.embed('some text');

    expect(result.enabled).toBe(true);
    expect(result.embedding).toBeNull();
    expect(result.error).toMatch(/provider outage/);
  });
});

describe('EmbeddingService — DB AiProvider selection (userId in context)', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('uses the DB provider when AiModelSelectorService finds one', async () => {
    const connection = {
      providerRowId: 'p1',
      provider: 'openai',
      kind: 'embedding',
      model: 'text-embedding-3-small',
      capabilities: {},
      settings: {},
    };
    ctx.modelSelectorMock.selectProvider.mockResolvedValue(connection);
    const adapterMock = {
      embed: vi.fn(async () => ({ embedding: [0.1, 0.2], model: 'text-embedding-3-small', dimensions: 2 })),
    };
    ctx.embeddingAdaptersMock.getAdapter.mockReturnValue(adapterMock);

    const result = await ctx.service.embed('hello', { userId: 'u1', scope: 'personal', space: 'personal' });

    expect(ctx.modelSelectorMock.selectProvider).toHaveBeenCalledWith('u1', {
      kind: 'embedding',
      scope: 'personal',
      space: 'personal',
    });
    expect(result.enabled).toBe(true);
    expect(result.dimensions).toBe(2);
    expect(ctx.providerMock.embed).not.toHaveBeenCalled();
    expect(ctx.callLoggerMock.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('falls back to the env provider when no DB provider is found', async () => {
    ctx.modelSelectorMock.selectProvider.mockResolvedValue(null);
    ctx.providerMock.isConfigured.mockReturnValue(false);

    const result = await ctx.service.embed('hello', { userId: 'u1' });

    expect(result.enabled).toBe(false);
  });

  it('degrades to no-embedding and logs a failure when the DB provider adapter throws', async () => {
    ctx.modelSelectorMock.selectProvider.mockResolvedValue({
      providerRowId: 'p1',
      provider: 'openai',
      kind: 'embedding',
      model: 'text-embedding-3-small',
      capabilities: {},
      settings: {},
    });
    const adapterMock = { embed: vi.fn(async () => { throw new Error('rate limited'); }) };
    ctx.embeddingAdaptersMock.getAdapter.mockReturnValue(adapterMock);

    const result = await ctx.service.embed('hello', { userId: 'u1' });

    expect(result.enabled).toBe(true);
    expect(result.embedding).toBeNull();
    expect(ctx.callLoggerMock.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
