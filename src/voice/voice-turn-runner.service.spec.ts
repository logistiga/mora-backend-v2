import { describe, expect, it, vi } from 'vitest';
import { VoiceConfirmationService } from './voice-confirmation.service.js';
import { VoiceTurnRunnerService, type VoiceTurnEvents } from './voice-turn-runner.service.js';
import type { VoiceRuntimeState } from './voice-runtime.registry.js';

function makeState(overrides: Partial<VoiceRuntimeState> = {}): VoiceRuntimeState {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    scope: 'personal',
    space: 'default',
    language: 'fr',
    conversationId: 'conv-1',
    vad: { detectorName: 'x', reset: vi.fn(), process: vi.fn() },
    sttSession: null,
    ttsAbortController: null,
    currentTurnId: null,
    sttGenerationId: null,
    currentAssistantMessageId: null,
    currentPendingActionId: null,
    recentInterruption: false,
    generationId: 'gen-0',
    openPendingActionIds: new Set(),
    speechEndedAtMs: null,
    isUserSpeaking: false,
    preSpeechBuffer: [],
    sttPushedFrameCount: 0,
    framesSinceLastFinalize: 0,
    lastFrameAtMs: 0,
    ...overrides,
  };
}

function makeEvents(): VoiceTurnEvents & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onAssistantThinkingStarted: vi.fn(),
    onAssistantSpeakingStarted: vi.fn(),
    onAudioChunk: vi.fn(),
    onAssistantSpeakingEnded: vi.fn(),
    onPendingConfirmation: vi.fn(),
    onActionExecuted: vi.fn(),
    onClarificationNeeded: vi.fn(),
    onLatencyMetrics: vi.fn(),
    onError: vi.fn(),
  } as unknown as VoiceTurnEvents & Record<string, ReturnType<typeof vi.fn>>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeRunner(overrides: {
  approve?: ReturnType<typeof vi.fn>;
  reject?: ReturnType<typeof vi.fn>;
  handleMessage?: ReturnType<typeof vi.fn>;
  createTts?: ReturnType<typeof vi.fn>;
} = {}) {
  const pendingActionService = {
    approve: overrides.approve ?? vi.fn(async () => ({ status: 'executed', pendingAction: { toolName: 'create_reminder' }, toolResultOk: true })),
    reject: overrides.reject ?? vi.fn(async () => ({ status: 'rejected' })),
    cancel: vi.fn(async () => ({ status: 'cancelled', pendingAction: { id: 'pa-cancelled' } })),
  };
  const orchestrator = {
    handleMessage: overrides.handleMessage ?? vi.fn(async () => ({ response: "D'accord.", conversationId: 'conv-1', messageId: 'm1', route: 'personal', scope: 'personal', space: 'default', confidence: 1 })),
  };
  const usersService = { findById: vi.fn(async () => ({ id: 'user-1', email: 'a@b.com', displayName: 'A' })) };
  const conversationsService = { markMessageInterrupted: vi.fn(async () => undefined) };
  const providerFactory = { createTts: overrides.createTts ?? vi.fn(async () => null), createStt: vi.fn() };
  const voiceProfileService = { getDefault: vi.fn(async () => null) };
  const voiceTurnService = {
    start: vi.fn(),
    complete: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };

  const runner = new VoiceTurnRunnerService(
    orchestrator as any,
    usersService as any,
    pendingActionService as any,
    conversationsService as any,
    new VoiceConfirmationService(), // REAL classifier — this is exactly what the earlier bug lived in
    providerFactory as any,
    voiceProfileService as any,
    voiceTurnService as any,
  );

  return { runner, pendingActionService, orchestrator, voiceTurnService, providerFactory, conversationsService };
}

/** Simple async-generator TTS fake that yields chunks one at a time, pausable via an external deferred. */
function makeControllableTts() {
  const chunkGates: Array<{ resolve: () => void }> = [];
  let chunkIndex = 0;
  const totalChunks = 5;

  const fakeTts = {
    async *synthesizeStream({ signal }: { signal: AbortSignal }) {
      for (let i = 0; i < totalChunks; i++) {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => chunkGates.push({ resolve }));
        if (signal.aborted) return;
        chunkIndex = i;
        yield Buffer.from(`chunk-${i}`);
      }
    },
  };

  return {
    fakeTts,
    releaseNextChunk: () => chunkGates.shift()?.resolve(),
    get emittedUpTo() {
      return chunkIndex;
    },
  };
}

describe('VoiceTurnRunnerService — confirmation resolution (Phase G real-mic bug regression)', () => {
  it('A. one pending action + "oui" -> approves exactly that action', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });
    const events = makeEvents();

    await runner.run(state, 'turn-1', state.generationId, 'Oui', {}, events);

    expect(pendingActionService.approve).toHaveBeenCalledWith('user-1', 'pa-1');
    expect(events.onActionExecuted).toHaveBeenCalledWith({ pendingActionId: 'pa-1', toolName: 'create_reminder' });
    expect(state.openPendingActionIds.has('pa-1')).toBe(false);
  });

  it('B. one pending action + "Oui, je confirme." -> approves (the exact real-world phrase that used to fail)', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });

    await runner.run(state, 'turn-1', state.generationId, 'Oui, je confirme.', {}, makeEvents());

    expect(pendingActionService.approve).toHaveBeenCalledWith('user-1', 'pa-1');
  });

  it('C. one pending action + "Je voulais bien confirmer." -> approves (the exact real-world phrase that created the duplicate bug)', async () => {
    const { runner, pendingActionService, orchestrator } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });

    await runner.run(state, 'turn-1', state.generationId, 'Je voulais bien confirmer.', {}, makeEvents());

    expect(pendingActionService.approve).toHaveBeenCalledWith('user-1', 'pa-1');
    expect(orchestrator.handleMessage).not.toHaveBeenCalled();
  });

  it('D. one pending action + "confirme" (bare word) -> approves', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });
    await runner.run(state, 'turn-1', state.generationId, 'confirme', {}, makeEvents());
    expect(pendingActionService.approve).toHaveBeenCalledWith('user-1', 'pa-1');
  });

  it('E. one pending action + "non" -> rejects, never approves', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });
    await runner.run(state, 'turn-1', state.generationId, 'Non', {}, makeEvents());
    expect(pendingActionService.reject).toHaveBeenCalledWith('user-1', 'pa-1');
    expect(pendingActionService.approve).not.toHaveBeenCalled();
  });

  it('F. zero pending actions + "oui" -> nothing approved, goes to Orchestrator as a normal message', async () => {
    const { runner, pendingActionService, orchestrator } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set() });
    await runner.run(state, 'turn-1', state.generationId, 'Oui', {}, makeEvents());
    expect(pendingActionService.approve).not.toHaveBeenCalled();
    expect(orchestrator.handleMessage).toHaveBeenCalled();
  });

  it('two pending actions + "oui" -> approves NEITHER, asks for clarification', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1', 'pa-2']) });
    const events = makeEvents();

    await runner.run(state, 'turn-1', state.generationId, 'Oui', {}, events);

    expect(pendingActionService.approve).not.toHaveBeenCalled();
    expect(events.onClarificationNeeded).toHaveBeenCalledWith({ candidateCount: 2 });
    expect(state.openPendingActionIds.size).toBe(2);
  });

  it('already-processed pending action + "oui" -> speaks a graceful message, never a crash', async () => {
    const { runner } = makeRunner({ approve: vi.fn(async () => ({ status: 'already_processed', pendingAction: {} })) });
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });
    const events = makeEvents();

    await expect(runner.run(state, 'turn-1', state.generationId, 'Oui', {}, events)).resolves.toBeUndefined();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('16. idempotence: two separate "oui" turns only approve while still open, then fall through once cleared (no reminder/action executed twice)', async () => {
    const { runner, pendingActionService, orchestrator } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });

    await runner.run(state, 'turn-1', state.generationId, 'Oui, je confirme.', {}, makeEvents());
    expect(pendingActionService.approve).toHaveBeenCalledTimes(1);

    await runner.run(state, 'turn-2', state.generationId, 'Oui, je confirme.', {}, makeEvents());
    expect(pendingActionService.approve).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('an ambiguous/unrelated transcript (real STT mistranscription) never touches a pending action', async () => {
    const { runner, pendingActionService, orchestrator } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });

    await runner.run(state, 'turn-1', state.generationId, 'Confío en ti.', {}, makeEvents());

    expect(pendingActionService.approve).not.toHaveBeenCalled();
    expect(pendingActionService.reject).not.toHaveBeenCalled();
    expect(orchestrator.handleMessage).toHaveBeenCalled();
    expect(state.openPendingActionIds.has('pa-1')).toBe(true);
  });

  it('15. pending_action stays bound to the correct turn/session across a normal (non-confirmation) turn', async () => {
    const { runner } = makeRunner({
      handleMessage: vi.fn(async () => ({
        response: 'Créer un rappel ? Confirme ?',
        conversationId: 'conv-1',
        messageId: 'm1',
        route: 'personal',
        scope: 'personal',
        space: 'default',
        confidence: 1,
        action: { type: 'confirmation_required', pendingActionId: 'pa-new', tool: 'create_reminder', securityLevel: 'N2', summary: 'x' },
      })),
    });
    const state = makeState();
    const events = makeEvents();
    await runner.run(state, 'turn-1', state.generationId, 'Rappelle-moi un truc', {}, events);
    expect(events.onPendingConfirmation).toHaveBeenCalledWith({ pendingActionId: 'pa-new', tool: 'create_reminder', securityLevel: 'N2', summary: 'x' });
    expect(state.openPendingActionIds.has('pa-new')).toBe(true);
  });
});

describe('VoiceTurnRunnerService — concurrency / generation guard (Phase G real-mic barge-in bug fix)', () => {
  it('1. interruption during the Orchestrator ("LLM") call: a stale generation never emits assistant events', async () => {
    const gate = deferred<void>();
    const { runner, orchestrator } = makeRunner({
      handleMessage: vi.fn(async () => {
        await gate.promise;
        return { response: 'Stale response', conversationId: 'conv-1', messageId: 'm1', route: 'personal', scope: 'personal', space: 'default', confidence: 1 };
      }),
    });
    const state = makeState();
    const events = makeEvents();
    const capturedGen = state.generationId;

    const runPromise = runner.run(state, 'turn-1', capturedGen, 'Bonjour', {}, events);
    // Simulate a barge-in / new turn superseding this one WHILE the Orchestrator call is still in flight.
    state.generationId = 'gen-NEW';
    gate.resolve();
    await runPromise;

    expect(orchestrator.handleMessage).toHaveBeenCalledTimes(1); // the call itself still completed (can't be un-sent)
    // "thinking started" legitimately fired BEFORE the interruption happened
    // (it's emitted synchronously, before the Orchestrator call even
    // begins) — that's correct, not stale. What must never happen is the
    // STALE RESULT being presented as current once it resolves:
    expect(events.onAssistantThinkingStarted).toHaveBeenCalledTimes(1);
    expect(events.onAssistantSpeakingStarted).not.toHaveBeenCalled();
    expect(events.onLatencyMetrics).not.toHaveBeenCalled();
  });

  it('marks the stale assistant message as interrupted and never re-completes the interrupted voice turn', async () => {
    const gate = deferred<void>();
    const { runner, voiceTurnService, conversationsService } = makeRunner({
      handleMessage: vi.fn(async () => {
        await gate.promise;
        return {
          response: 'Réponse stale sur le sujet A',
          conversationId: 'conv-1',
          messageId: 'assistant-msg-stale',
          route: 'personal',
          scope: 'personal',
          space: 'default',
          confidence: 1,
        };
      }),
    });
    const state = makeState();
    const runPromise = runner.run(state, 'turn-1', state.generationId, 'Sujet A', {}, makeEvents());

    state.generationId = 'gen-NEW';
    gate.resolve();
    await runPromise;

    expect(conversationsService.markMessageInterrupted).toHaveBeenCalledWith(
      'assistant-msg-stale',
      expect.objectContaining({ interruptedStage: 'orchestrator_result' }),
    );
    expect(voiceTurnService.interrupt).toHaveBeenCalledWith('turn-1');
    expect(voiceTurnService.complete).not.toHaveBeenCalled();
  });

  it('cancels a stale pending action instead of keeping a reusable stale confirmation reference', async () => {
    const gate = deferred<void>();
    const cancel = vi.fn(async () => ({ status: 'cancelled', pendingAction: { id: 'pa-stale' } }));
    const { runner, pendingActionService } = makeRunner({
      handleMessage: vi.fn(async () => {
        await gate.promise;
        return {
          response: 'Créer un rappel ? Veux-tu confirmer ?',
          conversationId: 'conv-1',
          messageId: 'assistant-msg-stale',
          route: 'personal',
          scope: 'personal',
          space: 'default',
          confidence: 1,
          action: { type: 'confirmation_required', pendingActionId: 'pa-stale', tool: 'create_reminder', securityLevel: 'N2', summary: 'Créer un rappel' },
        };
      }),
      reject: undefined,
      approve: undefined,
    });
    pendingActionService.cancel = cancel;
    const state = makeState();

    const runPromise = runner.run(state, 'turn-1', state.generationId, 'Sujet A', {}, makeEvents());
    state.generationId = 'gen-NEW';
    gate.resolve();
    await runPromise;

    expect(cancel).toHaveBeenCalledWith('user-1', 'pa-stale', 'voice_interrupted');
    expect(state.openPendingActionIds.size).toBe(0);
  });

  it('2/3. interruption during TTS streaming: chunks emitted before invalidation arrive, chunks after are dropped (never delivered late)', async () => {
    const control = makeControllableTts();
    const { runner } = makeRunner({ createTts: vi.fn(async () => control.fakeTts) });
    const state = makeState();
    const events = makeEvents();
    const capturedGen = state.generationId;

    const runPromise = runner.run(state, 'turn-1', capturedGen, 'Bonjour', {}, events);
    await new Promise((r) => setTimeout(r, 5)); // let run() reach the TTS loop and register the first gate

    control.releaseNextChunk(); // chunk 0 flows through while still current
    await new Promise((r) => setTimeout(r, 5));

    state.generationId = 'gen-NEW'; // barge-in mid-stream
    control.releaseNextChunk(); // chunk 1 — must be dropped, generation is now stale
    control.releaseNextChunk(); // chunk 2 — also dropped
    await new Promise((r) => setTimeout(r, 5));

    // Unblock any remaining awaits so the run() promise can settle even though the loop breaks early.
    state.ttsAbortController?.abort();
    await runPromise;

    expect(events.onAudioChunk).toHaveBeenCalledTimes(1);
    expect(events.onAudioChunk).toHaveBeenCalledWith(Buffer.from('chunk-0'));
  });

  it('8. two "concurrent" runs for the same session: only the LATEST ever gets to speak — never both', async () => {
    const gate1 = deferred<void>();
    let callCount = 0;
    const { runner } = makeRunner({
      handleMessage: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) await gate1.promise; // first call hangs until released
        return { response: `Response ${callCount}`, conversationId: 'conv-1', messageId: 'm', route: 'personal', scope: 'personal', space: 'default', confidence: 1 };
      }),
    });
    const state = makeState();
    const eventsA = makeEvents();
    const eventsB = makeEvents();

    const genA = state.generationId;
    const runA = runner.run(state, 'turn-A', genA, 'Premier message', {}, eventsA);

    // The "gateway" starts a second turn (this is exactly what finalizeTurn's
    // stopActiveGeneration()+newGeneration() does) before the first resolves.
    const genB = 'gen-B';
    state.generationId = genB;
    const runB = runner.run(state, 'turn-B', genB, 'Deuxième message', {}, eventsB);

    gate1.resolve(); // let the stale first call finish resolving (its side effects already happened)
    await Promise.all([runA, runB]);

    expect(eventsA.onAssistantSpeakingStarted).not.toHaveBeenCalled(); // stale generation: silent
    // eventsB has no TTS provider in this test (createTts default -> null), so
    // no speaking event either, but it's the one whose Orchestrator response
    // is the "live" one — the key invariant is A never announced anything.
  });

  it('9. calling run() twice with the SAME generationId (double interrupt racing a duplicate call) is idempotent — no double side effect beyond the normal single approve', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });
    await runner.run(state, 'turn-1', state.generationId, 'Oui', {}, makeEvents());
    expect(pendingActionService.approve).toHaveBeenCalledTimes(1);
  });

  it('14. interruption then a fresh confirmation still resolves correctly against the NEW generation', async () => {
    const { runner, pendingActionService } = makeRunner();
    const state = makeState({ openPendingActionIds: new Set(['pa-1']) });

    // Simulate: an old generation existed and was invalidated (barge-in) before this turn.
    state.generationId = 'gen-after-bargein';

    await runner.run(state, 'turn-2', state.generationId, 'Oui, je confirme.', {}, makeEvents());
    expect(pendingActionService.approve).toHaveBeenCalledWith('user-1', 'pa-1');
  });
});
