import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiTtsProvider } from './openai-tts.provider.js';

function provider(model: string) {
  const connection = { baseUrl: '', apiKey: 'k', model, providerRowId: 'p' } as never;
  const callLogger = { log: vi.fn(async () => undefined) } as never;
  return new OpenAiTtsProvider(connection, callLogger, 'u1');
}

async function collect(gen: AsyncGenerator<Buffer>) {
  const chunks: Buffer[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

const params = { text: 'Bonjour', voiceId: 'alloy', language: 'fr', speed: 1, signal: new AbortController().signal };

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body));
}

describe('OpenAiTtsProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('upgrades the legacy tts-1 model to the natural model with a natural voice and delivery instructions', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collect(provider('tts-1').synthesizeStream({ ...params, voiceId: '' }));

    expect(chunks.length).toBeGreaterThan(0);
    const [body] = sentBodies(fetchMock);
    expect(body.model).toBe('gpt-4o-mini-tts');
    expect(body.voice).toBe('marin');
    expect(body.instructions).toEqual(expect.any(String));
  });

  it('falls back to the configured model when the natural model is refused', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unknown model', { status: 400 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collect(provider('tts-1').synthesizeStream(params));

    expect(chunks).toHaveLength(1);
    const [first, second] = sentBodies(fetchMock);
    expect(first.model).toBe('gpt-4o-mini-tts');
    expect(second.model).toBe('tts-1');
    expect(second.instructions).toBeUndefined();
  });

  it('does not retry a custom model: one request, no fallback', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collect(provider('my-custom-tts').synthesizeStream(params));

    expect(chunks).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBodies(fetchMock)[0].model).toBe('my-custom-tts');
  });
});
