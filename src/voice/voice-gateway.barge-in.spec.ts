import { describe, expect, it, vi } from 'vitest';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeGateway() {
  const registry = new VoiceRuntimeRegistry();
  const sessionService = {
    transition: vi.fn(async () => undefined),
    getById: vi.fn(),
    isExpired: vi.fn(() => false),
    end: vi.fn(),
  };
  let turnIndex = 0;
  const turnService = {
    start: vi.fn(async () => ({ id: `turn-${++turnIndex}` })),
    interrupt: vi.fn(async () => undefined),
    complete: vi.fn(),
    fail: vi.fn(),
  };
  const turnRunner = { run: vi.fn(async () => undefined) };
  const providerFactory = { createStt: vi.fn(), createTts: vi.fn(async () => null) };
  const conversationsService = { markMessageInterrupted: vi.fn(async () => undefined) };
  const pendingActionService = { cancel: vi.fn(async () => ({ status: 'cancelled' })) };

  const gateway = new VoiceGateway(
    {} as any,
    {} as any,
    {} as any,
    sessionService as any,
    turnService as any,
    registry,
    turnRunner as any,
    providerFactory as any,
    new EndOfTurnService(),
    conversationsService as any,
    pendingActionService as any,
  );

  const state = registry.create({
    sessionId: 'session-1',
    userId: 'user-1',
    scope: 'personal',
    space: 'default',
    language: 'fr',
    conversationId: 'conv-1',
  });

  const socket = {
    readyState: 1,
    send: vi.fn(),
  };

  return { gateway, state, socket, turnRunner, turnService };
}

describe('VoiceGateway — stale STT finalize guard (Phase F barge-in regression)', () => {
  it('ignores a stale transcript if an older STT finalize resolves after a newer generation already started', async () => {
    const { gateway, state, socket, turnRunner } = makeGateway();
    const staleFinalize = deferred<string>();

    state.sttSession = {
      pushAudio: vi.fn(),
      finalize: vi.fn(async () => staleFinalize.promise),
      abort: vi.fn(),
    };
    state.sttGenerationId = state.generationId;

    const staleFinalizePromise = (gateway as any).finalizeTurn(socket, 'session-1');
    await Promise.resolve(); // let finalizeTurn capture the session and enter the await

    (gateway as any).interrupt('session-1'); // user barges in while the first finalize() is still pending

    state.sttSession = {
      pushAudio: vi.fn(),
      finalize: vi.fn(async () => 'fresh transcript'),
      abort: vi.fn(),
    };
    state.sttGenerationId = state.generationId;
    await (gateway as any).finalizeTurn(socket, 'session-1');

    staleFinalize.resolve('stale transcript');
    await staleFinalizePromise;

    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(turnRunner.run).toHaveBeenCalledWith(
      state,
      'turn-1',
      expect.any(String),
      'fresh transcript',
      expect.objectContaining({ sttLatencyMs: expect.any(Number) }),
      expect.any(Object),
    );

    const transcriptEvents = socket.send.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => typeof payload === 'string')
      .map((payload) => JSON.parse(payload as string))
      .filter((payload) => payload.event === 'transcript.final');

    expect(transcriptEvents).toEqual([{ event: 'transcript.final', data: { text: 'fresh transcript' } }]);
  });
});
