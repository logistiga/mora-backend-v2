import { describe, expect, it, vi } from 'vitest';
import { AvatarStateService } from '../avatar/avatar-state.service.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';

/**
 * Targeted validation of 32a274d (voice session end propagation and
 * turnId/generationId on assistant events) — same harness as
 * voice-gateway.barge-in.spec.ts.
 */
function makeGateway() {
  const registry = new VoiceRuntimeRegistry();
  const sessionService = {
    transition: vi.fn(async () => undefined),
    getById: vi.fn(),
    isExpired: vi.fn(() => false),
    end: vi.fn(),
    onSessionEnded: vi.fn(),
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
    new AvatarStateService(),
  );

  const state = registry.create({
    sessionId: 'session-1',
    userId: 'user-1',
    scope: 'personal',
    space: 'default',
    language: 'fr',
    conversationId: 'conv-1',
  });

  const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  const sent = () => socket.send.mock.calls.map(([payload]) => JSON.parse(payload as string));

  return { gateway, registry, state, socket, sent, turnRunner, pendingActionService };
}

async function runOneTurn(ctx: ReturnType<typeof makeGateway>, transcript = 'bonjour') {
  ctx.state.sttSession = { pushAudio: vi.fn(), finalize: vi.fn(async () => transcript), abort: vi.fn() };
  ctx.state.sttGenerationId = ctx.state.generationId;
  await (ctx.gateway as any).finalizeTurn(ctx.socket, 'session-1');
  const call = ctx.turnRunner.run.mock.calls.at(-1) as unknown as unknown[];
  return { turnId: call[1] as string, generationId: call[2] as string, events: call[5] as Record<string, (p?: unknown) => void> };
}

describe('32a274d — turnId / generationId on voice events', () => {
  it('stamps transcript.final and every assistant.* lifecycle event with the same turnId and generationId', async () => {
    const ctx = makeGateway();
    const { turnId, generationId, events } = await runOneTurn(ctx);

    events.onAssistantThinkingStarted();
    events.onAssistantSpeakingStarted({ text: 'Bonjour !', channel: 'voice', voiceSpeed: 1, lipSyncEnabled: true });
    events.onAssistantSpeakingEnded();

    const byEvent = (name: string) => ctx.sent().filter((e) => e.event === name);
    expect(byEvent('transcript.final')).toEqual([{ event: 'transcript.final', data: { text: 'bonjour', generationId } }]);
    for (const name of ['assistant.thinking.started', 'assistant.speaking.started', 'assistant.speaking.ended']) {
      expect(byEvent(name)).toEqual([{ event: name, data: { turnId, generationId } }]);
    }
    expect(turnId).toBe('turn-1');
    expect(generationId).toBe(ctx.state.generationId);
  });

  it('gives a new turn a new generationId after a barge-in, and runs exactly one turn per generation (no double audio)', async () => {
    const ctx = makeGateway();
    const first = await runOneTurn(ctx, 'premier');
    (ctx.gateway as any).interrupt('session-1');
    const second = await runOneTurn(ctx, 'second');

    expect(second.generationId).not.toBe(first.generationId);
    expect(second.turnId).not.toBe(first.turnId);
    expect(ctx.turnRunner.run).toHaveBeenCalledTimes(2);
  });
});

describe('32a274d — session end propagated to the live socket', () => {
  it('REST end: sends session.ended, closes with 1000, aborts the active generation and drops runtime state', () => {
    const ctx = makeGateway();
    const ttsAbort = new AbortController();
    ctx.state.ttsAbortController = ttsAbort;
    (ctx.gateway as any).sockets.set('session-1', ctx.socket);

    (ctx.gateway as any).closeSessionSocket('session-1');

    const seq = ctx.sent().map((e) => (e.event === 'avatar.state' ? `avatar.state:${e.data.state}` : e.event));
    expect(seq).toEqual(['avatar.state:disconnected', 'session.ended']);
    expect(ctx.socket.close).toHaveBeenCalledTimes(1);
    expect(ctx.socket.close).toHaveBeenCalledWith(1000, 'ended');
    expect(ttsAbort.signal.aborted).toBe(true);
    expect((ctx.gateway as any).sockets.has('session-1')).toBe(false);
    expect(ctx.registry.get('session-1')).toBeUndefined();
  });

  it('is idempotent: a second teardown of the same session emits nothing more', () => {
    const ctx = makeGateway();
    (ctx.gateway as any).sockets.set('session-1', ctx.socket);
    (ctx.gateway as any).closeSessionSocket('session-1');
    (ctx.gateway as any).closeSessionSocket('session-1');
    expect(ctx.sent().filter((e) => e.event === 'session.ended')).toHaveLength(1);
    expect(ctx.sent().filter((e) => e.event === 'avatar.state')).toHaveLength(1);
    expect(ctx.socket.close).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a session with no live socket (other user / already closed)', () => {
    const ctx = makeGateway();
    (ctx.gateway as any).closeSessionSocket('session-unknown');
    expect(ctx.socket.send).not.toHaveBeenCalled();
    expect(ctx.registry.get('session-1')).toBeDefined();
  });

  it('keeps a pending confirmation already shown to the user confirmable after a barge-in (no voice confirmation regression)', () => {
    const ctx = makeGateway();
    ctx.state.currentPendingActionId = 'pending-1';
    ctx.state.openPendingActionIds.add('pending-1');
    (ctx.gateway as any).interrupt('session-1');
    expect(ctx.pendingActionService.cancel).not.toHaveBeenCalled();
  });
});
