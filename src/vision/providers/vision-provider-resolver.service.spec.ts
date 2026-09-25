import { describe, expect, it, vi } from 'vitest';
import { VisionProviderResolverService } from './vision-provider-resolver.service.js';

describe('VisionProviderResolverService', () => {
  it('prefers a dedicated vision provider for the requested scope and space', async () => {
    const dedicated = { id: 'vision-1', provider: 'openai', kind: 'vision', model: 'gpt-4.1-mini' };
    const aiProviderService = {
      getProviderForUseCase: vi
        .fn()
        .mockResolvedValueOnce(dedicated)
        .mockResolvedValueOnce(null),
      toConnection: vi.fn(() => ({ providerRowId: 'vision-1', provider: 'openai', kind: 'vision', model: 'gpt-4.1-mini', capabilities: {} })),
    };
    const service = new VisionProviderResolverService(aiProviderService as never);

    const result = await service.resolve('u1', { scope: 'personal', space: 'personal' });

    expect(result?.kind).toBe('vision');
    expect(aiProviderService.getProviderForUseCase).toHaveBeenNthCalledWith(1, 'u1', {
      kind: 'vision',
      scope: 'personal',
      space: 'personal',
    });
  });

  it('falls back to a chat provider only when it explicitly advertises vision capability', async () => {
    const chat = { id: 'chat-1', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini' };
    const aiProviderService = {
      getProviderForUseCase: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(chat),
      toConnection: vi.fn(() => ({ providerRowId: 'chat-1', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini', capabilities: { vision: true } })),
    };
    const service = new VisionProviderResolverService(aiProviderService as never);

    const result = await service.resolve('u1', { scope: 'professional', space: 'code' });

    expect(result?.providerRowId).toBe('chat-1');
    expect(result?.capabilities.vision).toBe(true);
  });

  it('returns null when neither a dedicated vision provider nor a vision-capable chat provider exists', async () => {
    const aiProviderService = {
      getProviderForUseCase: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'chat-2', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini' }),
      toConnection: vi.fn(() => ({ providerRowId: 'chat-2', provider: 'openai', kind: 'chat', model: 'gpt-4o-mini', capabilities: { vision: false } })),
    };
    const service = new VisionProviderResolverService(aiProviderService as never);

    await expect(service.resolve('u1', { scope: 'professional', space: 'general' })).resolves.toBeNull();
  });
});
