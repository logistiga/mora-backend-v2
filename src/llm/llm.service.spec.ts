import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderInterface } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';

function buildService() {
  const providerMock = {
    name: 'test-provider',
    isConfigured: vi.fn(() => false),
    complete: vi.fn(),
  };
  const modelSelectorMock = {
    selectProvider: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  };
  const chatAdaptersMock = { getAdapter: vi.fn() };
  const callLoggerMock = { log: vi.fn() };

  const service = new LlmService(
    providerMock as unknown as LlmProviderInterface,
    modelSelectorMock as never,
    chatAdaptersMock as never,
    callLoggerMock as never,
  );

  return { service, providerMock, modelSelectorMock, chatAdaptersMock, callLoggerMock };
}

describe('LlmService — env-configured fallback (no userId in context)', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('never throws and returns an explicit "not configured" response when nothing is configured', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(false);

    const result = await ctx.service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.configured).toBe(false);
    expect(result.content).toMatch(/configuration llm manquante/i);
    expect(ctx.providerMock.complete).not.toHaveBeenCalled();
    expect(ctx.modelSelectorMock.selectProvider).not.toHaveBeenCalled();
  });

  it('passes through a successful completion from the env-configured provider', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(true);
    ctx.providerMock.complete.mockResolvedValue({
      content: 'Bonjour !',
      provider: 'test-provider',
      model: 'test-model',
    });

    const result = await ctx.service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toEqual({
      configured: true,
      content: 'Bonjour !',
      provider: 'test-provider',
      model: 'test-model',
    });
  });

  it('degrades gracefully (never throws) when the env-configured provider fails', async () => {
    ctx.providerMock.isConfigured.mockReturnValue(true);
    ctx.providerMock.complete.mockRejectedValue(new Error('network down'));

    const result = await ctx.service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.configured).toBe(true);
    expect(result.content).toMatch(/échoué/i);
  });
});

describe('LlmService — DB AiProvider selection (userId in context)', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('uses the DB provider when AiModelSelectorService finds one, without touching the env provider', async () => {
    const connection = {
      providerRowId: 'p1',
      provider: 'openai',
      kind: 'chat',
      model: 'gpt-4o-mini',
      capabilities: {},
      settings: {},
    };
    ctx.modelSelectorMock.selectProvider.mockResolvedValue(connection);
    const adapterMock = {
      complete: vi.fn(async () => ({ content: 'Réponse DB', model: 'gpt-4o-mini' })),
    };
    ctx.chatAdaptersMock.getAdapter.mockReturnValue(adapterMock);

    const result = await ctx.service.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'u1', scope: 'personal', space: 'personal' },
    );

    expect(ctx.modelSelectorMock.selectProvider).toHaveBeenCalledWith('u1', {
      kind: 'chat',
      scope: 'personal',
      space: 'personal',
      route: undefined,
    });
    expect(result).toEqual({ configured: true, content: 'Réponse DB', provider: 'openai', model: 'gpt-4o-mini' });
    expect(ctx.providerMock.complete).not.toHaveBeenCalled();
    expect(ctx.callLoggerMock.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('falls back to the env provider when no DB provider is found for this user', async () => {
    ctx.modelSelectorMock.selectProvider.mockResolvedValue(null);
    ctx.providerMock.isConfigured.mockReturnValue(true);
    ctx.providerMock.complete.mockResolvedValue({
      content: 'Réponse env',
      provider: 'test-provider',
      model: 'test-model',
    });

    const result = await ctx.service.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'u1' },
    );

    expect(result.content).toBe('Réponse env');
  });

  it('degrades gracefully and logs a failed call when the DB provider adapter throws', async () => {
    const connection = {
      providerRowId: 'p1',
      provider: 'openai',
      kind: 'chat',
      model: 'gpt-4o-mini',
      capabilities: {},
      settings: {},
    };
    ctx.modelSelectorMock.selectProvider.mockResolvedValue(connection);
    const adapterMock = { complete: vi.fn(async () => { throw new Error('401 Unauthorized'); }) };
    ctx.chatAdaptersMock.getAdapter.mockReturnValue(adapterMock);

    const result = await ctx.service.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'u1' },
    );

    expect(result.configured).toBe(true);
    expect(result.content).toMatch(/échoué/i);
    expect(ctx.callLoggerMock.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    // The raw provider error is logged internally but never surfaced to the caller.
    expect(result.content).not.toMatch(/401|Unauthorized/);
  });

  it('falls back to env when no adapter is registered for the selected provider', async () => {
    ctx.modelSelectorMock.selectProvider.mockResolvedValue({
      providerRowId: 'p1',
      provider: 'unknown-provider',
      kind: 'chat',
      model: 'x',
      capabilities: {},
      settings: {},
    });
    ctx.chatAdaptersMock.getAdapter.mockReturnValue(null);
    ctx.providerMock.isConfigured.mockReturnValue(false);

    const result = await ctx.service.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'u1' },
    );

    expect(result.configured).toBe(false); // fell through to env, which is also unconfigured
  });
});
