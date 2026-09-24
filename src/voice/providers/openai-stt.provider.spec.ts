import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiSttProvider } from './openai-stt.provider.js';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';

const connection = {
  providerRowId: 'p1',
  provider: 'openai',
  kind: 'stt',
  model: 'whisper-1',
  baseUrl: undefined,
  apiKey: 'sk-fake',
  capabilities: {},
  settings: {},
} as unknown as ResolvedProviderConnection;

const callLogger = { log: vi.fn(async () => undefined) };

function frame(bytes = 320): Buffer {
  return Buffer.alloc(bytes, 1);
}

describe('OpenAiSttProvider — language hint + session isolation (Phase G §E/§13)', () => {
  let capturedForms: FormData[];

  beforeEach(() => {
    capturedForms = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedForms.push(init.body as FormData);
        return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('12. forwards an explicit language=fr hint to Whisper as the "language" form field', async () => {
    const provider = new OpenAiSttProvider(connection, callLogger as any, 'user-1');
    const session = provider.startSession({ language: 'fr' });
    session.pushAudio(frame());
    await session.finalize();

    expect(capturedForms[0].get('language')).toBe('fr');
  });

  it('does NOT send a language field for language=auto (never forces a hint the caller did not choose)', async () => {
    const provider = new OpenAiSttProvider(connection, callLogger as any, 'user-1');
    const session = provider.startSession({ language: 'auto' });
    session.pushAudio(frame());
    await session.finalize();

    expect(capturedForms[0].get('language')).toBeNull();
  });

  it('maps darija to the ISO-639-1 "ar" code honestly (no dedicated darija code exists)', async () => {
    const provider = new OpenAiSttProvider(connection, callLogger as any, 'user-1');
    const session = provider.startSession({ language: 'darija' });
    session.pushAudio(frame());
    await session.finalize();

    expect(capturedForms[0].get('language')).toBe('ar');
  });

  it('13. two independent sessions never mix their audio: session A\'s bytes never appear in session B\'s upload', async () => {
    const provider = new OpenAiSttProvider(connection, callLogger as any, 'user-1');
    const sessionA = provider.startSession({ language: 'fr' });
    const sessionB = provider.startSession({ language: 'fr' });

    sessionA.pushAudio(frame(320)); // 1 frame
    sessionB.pushAudio(frame(320));
    sessionB.pushAudio(frame(320));
    sessionB.pushAudio(frame(320)); // 3 frames — distinctly more audio than A

    await sessionA.finalize();
    await sessionB.finalize();

    const fileA = capturedForms[0].get('file') as File;
    const fileB = capturedForms[1].get('file') as File;
    // WAV = 44-byte header + PCM payload; B has 3x the frames of A, so its
    // upload must be measurably larger — if audio were mixed/shared between
    // sessions, both uploads would be identical or B would be even bigger
    // than 3x. This proves each session's frame buffer is independent.
    expect(fileB.size).toBeGreaterThan(fileA.size);
    expect(fileA.size).toBe(44 + 320);
    expect(fileB.size).toBe(44 + 320 * 3);
  });

  it('abort() discards buffered audio — a finalize() after abort() sends nothing and returns an empty transcript', async () => {
    const provider = new OpenAiSttProvider(connection, callLogger as any, 'user-1');
    const session = provider.startSession({ language: 'fr' });
    session.pushAudio(frame());
    session.abort();
    const transcript = await session.finalize();

    expect(transcript).toBe('');
    expect(capturedForms.length).toBe(0); // never even called the network
  });
});
