import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarStateService } from '../avatar/avatar-state.service.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';

function silentFrame(samples = 320): Buffer {
  return Buffer.alloc(samples * 2, 0);
}

function loudFrame(samples = 320, amplitude = 8000): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  return buf;
}

/**
 * BUG REGRESSION (Phase G real-mic investigation — proven root cause of STT
 * foreign-language hallucinations): a real test session logged an STT
 * request built from 1544 frames (~308s) for a VAD-confirmed speech window
 * of only ~3s. This exercises VoiceGateway's real (non-mocked)
 * handleAudioFrame + VoiceRuntimeRegistry + EnergyVadService pipeline —
 * everything except the network-bound STT provider itself, which is faked
 * to simply record every Buffer it was actually given — to prove that
 * silence is no longer pushed to the STT session, only the real speech
 * window (plus the intentional small pre-roll).
 *
 * Uses fake timers because EnergyVadService's start/silence windows are
 * time-based (Date.now()), not frame-count-based — real elapsed wall-clock
 * time must pass between frames for VAD to confirm speech_started/ended.
 */
function makeGateway() {
  const pushedFrames: Buffer[] = [];
  const fakeSttSession = {
    pushAudio: vi.fn((frame: Buffer) => pushedFrames.push(frame)),
    finalize: vi.fn(async () => 'ok'),
    abort: vi.fn(),
  };
  const providerFactory = { createStt: vi.fn(async () => ({ startSession: () => fakeSttSession })), createTts: vi.fn(async () => null) };
  const sessionService = { transition: vi.fn(async () => undefined), getById: vi.fn(), isExpired: vi.fn(() => false), end: vi.fn() };
  const turnService = { start: vi.fn(async () => ({ id: 'turn-1' })), interrupt: vi.fn(async () => undefined), complete: vi.fn(), fail: vi.fn() };
  const turnRunner = { run: vi.fn(async () => undefined) };
  const conversationsService = { markMessageInterrupted: vi.fn(async () => undefined) };
  const pendingActionService = { cancel: vi.fn(async () => ({ status: 'cancelled' })) };
  const registry = new VoiceRuntimeRegistry();

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

  return { gateway, state, pushedFrames };
}

const FRAME_MS = 20; // matches the fake frames' ~320 samples @16kHz

describe('VoiceGateway audio silence gating (Phase G real-mic bug fix)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT push any silence frame to the STT session while the user is not speaking', async () => {
    const { gateway, pushedFrames } = makeGateway();
    const fakeSocket = { readyState: 1, send: vi.fn() };

    for (let i = 0; i < 100; i++) {
      (gateway as any).handleAudioFrame(fakeSocket, 'session-1', silentFrame());
      await vi.advanceTimersByTimeAsync(FRAME_MS); // flushes microtasks (the lazy createStt().then()) between frames, like real event-loop ticks
    }

    expect(pushedFrames.length).toBe(0);
  });

  it('CRITICAL: only pushes the real speech window (+ small pre-roll) to STT, never the surrounding silence — proven fix for the 308s-for-3s-of-speech bug', async () => {
    const { gateway, state, pushedFrames } = makeGateway();
    const fakeSocket = { readyState: 1, send: vi.fn() };

    // 2 seconds of silence BEFORE speaking — must never reach STT.
    for (let i = 0; i < 100; i++) {
      (gateway as any).handleAudioFrame(fakeSocket, 'session-1', silentFrame());
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    }
    expect(pushedFrames.length).toBe(0);

    // Real speech: enough loud frames, spaced in real time, to cross EnergyVadService's 120ms start window.
    for (let i = 0; i < 15; i++) {
      (gateway as any).handleAudioFrame(fakeSocket, 'session-1', loudFrame());
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    }
    expect(state.isUserSpeaking).toBe(true);
    const pushedDuringSpeech = pushedFrames.length;
    expect(pushedDuringSpeech).toBeGreaterThan(0);
    expect(pushedDuringSpeech).toBeLessThanOrEqual(15 + 3); // speech frames + at most the pre-roll buffer

    // A long silence tail (simulating the real bug's 308s / ~1500 frames) must NOT keep accumulating into pushedFrames.
    for (let i = 0; i < 500; i++) {
      (gateway as any).handleAudioFrame(fakeSocket, 'session-1', silentFrame());
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    }

    expect(state.isUserSpeaking).toBe(false); // VAD confirmed the silence
    expect(pushedFrames.length).toBeLessThan(50); // nowhere near the 500 silence frames fed in, let alone the real bug's 1544
  });
});
