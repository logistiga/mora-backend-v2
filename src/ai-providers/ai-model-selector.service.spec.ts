import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModelSelectorService } from './ai-model-selector.service.js';

function buildService() {
  const aiProviderServiceMock = {
    getProviderForUseCase: vi.fn(),
    toConnection: vi.fn((row: { id: string }) => ({ providerRowId: row.id, provider: 'openai' })),
  };
  const service = new AiModelSelectorService(aiProviderServiceMock as never);
  return { service, aiProviderServiceMock };
}

describe('AiModelSelectorService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('returns null when no provider row is found', async () => {
    ctx.aiProviderServiceMock.getProviderForUseCase.mockResolvedValue(null);

    const result = await ctx.service.selectProvider('u1', { kind: 'chat' });

    expect(result).toBeNull();
    expect(ctx.aiProviderServiceMock.toConnection).not.toHaveBeenCalled();
  });

  it('delegates selection to AiProviderService.getProviderForUseCase with kind/scope/space', async () => {
    ctx.aiProviderServiceMock.getProviderForUseCase.mockResolvedValue({ id: 'p1' });

    await ctx.service.selectProvider('u1', {
      kind: 'chat',
      scope: 'professional',
      space: 'logistiga',
      route: 'professional',
      complexity: 'high',
    });

    expect(ctx.aiProviderServiceMock.getProviderForUseCase).toHaveBeenCalledWith('u1', {
      kind: 'chat',
      scope: 'professional',
      space: 'logistiga',
    });
  });

  it('resolves the found row into a connection via AiProviderService.toConnection', async () => {
    ctx.aiProviderServiceMock.getProviderForUseCase.mockResolvedValue({ id: 'p1' });

    const result = await ctx.service.selectProvider('u1', { kind: 'chat' });

    expect(ctx.aiProviderServiceMock.toConnection).toHaveBeenCalledWith({ id: 'p1' });
    expect(result?.providerRowId).toBe('p1');
  });
});
