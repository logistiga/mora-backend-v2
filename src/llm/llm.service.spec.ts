import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderInterface } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';

describe('LlmService', () => {
  let providerMock: { name: string; isConfigured: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };
  let service: LlmService;

  beforeEach(() => {
    providerMock = {
      name: 'test-provider',
      isConfigured: vi.fn(() => false),
      complete: vi.fn(),
    };
    service = new LlmService(providerMock as unknown as LlmProviderInterface);
  });

  it('never throws and returns an explicit "not configured" response when the provider is not configured', async () => {
    providerMock.isConfigured.mockReturnValue(false);

    const result = await service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.configured).toBe(false);
    expect(result.content).toMatch(/configuration llm manquante/i);
    expect(providerMock.complete).not.toHaveBeenCalled();
  });

  it('passes through a successful completion from a configured provider', async () => {
    providerMock.isConfigured.mockReturnValue(true);
    providerMock.complete.mockResolvedValue({
      content: 'Bonjour !',
      provider: 'test-provider',
      model: 'test-model',
    });

    const result = await service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toEqual({
      configured: true,
      content: 'Bonjour !',
      provider: 'test-provider',
      model: 'test-model',
    });
  });

  it('degrades gracefully (never throws) when a configured provider fails', async () => {
    providerMock.isConfigured.mockReturnValue(true);
    providerMock.complete.mockRejectedValue(new Error('network down'));

    const result = await service.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.configured).toBe(true);
    expect(result.content).toMatch(/échoué/i);
  });
});
