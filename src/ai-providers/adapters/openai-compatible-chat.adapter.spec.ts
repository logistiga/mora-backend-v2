import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedProviderConnection } from '../ai-provider.types.js';
import { OpenAiCompatibleChatAdapter } from './openai-compatible-chat.adapter.js';

const baseConnection: ResolvedProviderConnection = {
  providerRowId: 'p1',
  provider: 'openai',
  kind: 'chat',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'sk-test-key',
  capabilities: { tools: true, vision: false, jsonMode: true },
  settings: {},
};

describe('OpenAiCompatibleChatAdapter', () => {
  let adapter: OpenAiCompatibleChatAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new OpenAiCompatibleChatAdapter();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the API key as a Bearer header and never in the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], model: 'gpt-4o-mini' }), {
        status: 200,
      }),
    );

    await adapter.complete(baseConnection, { messages: [{ role: 'user', content: 'hi' }] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect(url).not.toContain('sk-test-key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
  });

  it('omits the Authorization header when the connection has no key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }),
    );

    await adapter.complete({ ...baseConnection, apiKey: undefined }, { messages: [{ role: 'user', content: 'hi' }] });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('parses the completion content and model from a successful response', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Bonjour !' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.complete(baseConnection, { messages: [{ role: 'user', content: 'salut' }] });

    expect(result.content).toBe('Bonjour !');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.totalTokens).toBe(13);
  });

  it('throws (never returns a fake success) on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(
      adapter.complete(baseConnection, { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/401/);
  });

  it('reports capabilities straight from the connection row', () => {
    expect(adapter.supportsTools(baseConnection)).toBe(true);
    expect(adapter.supportsVision(baseConnection)).toBe(false);
    expect(adapter.supportsJsonMode(baseConnection)).toBe(true);
  });

  it('lists the OpenAI-compatible-wire providers it supports', () => {
    expect(adapter.supportedProviders).toContain('openai');
    expect(adapter.supportedProviders).toContain('custom_openai_compatible');
  });
});
