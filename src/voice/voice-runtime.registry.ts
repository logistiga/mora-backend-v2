import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EnergyVadService } from './vad/energy-vad.service.js';
import type { VoiceActivityDetectorInterface } from './vad/vad.interface.js';
import type { SttSession } from './providers/stt-provider.interface.js';

export interface VoiceRuntimeState {
  sessionId: string;
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  language: string;
  conversationId: string;

  vad: VoiceActivityDetectorInterface;
  sttSession: SttSession | null;
  ttsAbortController: AbortController | null;
  currentTurnId: string | null;
  sttGenerationId: string | null;
  currentAssistantMessageId: string | null;
  currentPendingActionId: string | null;
  recentInterruption: boolean;

  /**
   * BUG FIX (Phase G real-mic regression — concurrent assistant responses):
   * identifies the single currently-active "generation" (one user turn's
   * full LLM+TTS response) for this session. Bumped to a fresh id every
   * time a new turn starts AND every time an interrupt happens. Any
   * in-flight async work (an Orchestrator call still awaiting, a TTS chunk
   * arriving late) MUST compare its own captured generationId against
   * `state.generationId` before emitting anything — a mismatch means a
   * newer turn has already superseded it, and the stale work is silently
   * discarded rather than reaching the client. This is what guarantees at
   * most one active assistant generation per session at any time.
   */
  generationId: string;

  /** pendingActionId values proposed during this session that are still awaiting a spoken confirmation (AGENTS §23). */
  openPendingActionIds: Set<string>;

  speechEndedAtMs: number | null;
  isUserSpeaking: boolean;

  /**
   * BUG FIX (Phase G real-mic investigation — proven root cause of STT
   * foreign-language hallucinations): a small rolling buffer of the most
   * recent frames, kept even while NOT speaking, so the moment VAD confirms
   * speech_started we can flush a little pre-roll into the STT session
   * without clipping the first word — see handleAudioFrame(). Frames are
   * pushed to the actual STT session ONLY while the user is confirmed
   * speaking (isUserSpeaking) — never during silence, however long it
   * lasts. Proven necessary: a real test session logged an STT request
   * built from 1544 frames (~308s) for a VAD-confirmed speech window of
   * only ~3s — minutes of near-silent audio were being sent to Whisper,
   * which is documented to hallucinate (including in random other
   * languages) on exactly that kind of input.
   */
  preSpeechBuffer: Buffer[];
  /** Frames actually pushed to the STT session (speech only, pre-roll included) — for honest debug reporting, distinct from framesSinceLastFinalize's flood-guard total. */
  sttPushedFrameCount: number;

  /** Basic audio-flood guard (AGENTS §26): total frames received since the last finalize(). */
  framesSinceLastFinalize: number;
  lastFrameAtMs: number;
}

const MAX_FRAMES_PER_TURN = 2000; // ~200-400s of audio at 100-200ms/frame — generous but bounded
export const PRE_SPEECH_BUFFER_FRAMES = 3; // ~600ms of pre-roll at the recommended 200ms/frame — avoids clipping the first word

/**
 * In-memory registry of live, non-persisted per-session objects (STT
 * session handle, VAD instance, TTS AbortController, open confirmation
 * set). Deliberately separate from VoiceSessionService (which owns only the
 * persisted `voice_sessions` row) — nothing here is durable, and a process
 * restart clears it (an acceptable Phase F limitation: an in-flight voice
 * session does not survive a server restart, same as any other in-memory
 * WebSocket state; documented, not hidden).
 */
@Injectable()
export class VoiceRuntimeRegistry {
  private readonly logger = new Logger(VoiceRuntimeRegistry.name);
  private readonly sessions = new Map<string, VoiceRuntimeState>();

  create(params: {
    sessionId: string;
    userId: string;
    scope: 'personal' | 'professional';
    space: string;
    language: string;
    conversationId: string;
  }): VoiceRuntimeState {
    const state: VoiceRuntimeState = {
      ...params,
      vad: new EnergyVadService(),
      sttSession: null,
      ttsAbortController: null,
      currentTurnId: null,
      sttGenerationId: null,
      currentAssistantMessageId: null,
      currentPendingActionId: null,
      recentInterruption: false,
      generationId: randomUUID(),
      openPendingActionIds: new Set(),
      speechEndedAtMs: null,
      isUserSpeaking: false,
      preSpeechBuffer: [],
      sttPushedFrameCount: 0,
      framesSinceLastFinalize: 0,
      lastFrameAtMs: 0,
    };
    this.sessions.set(params.sessionId, state);
    return state;
  }

  get(sessionId: string): VoiceRuntimeState | undefined {
    return this.sessions.get(sessionId);
  }

  /** Returns false (and does not count the frame) once the per-turn cap is exceeded — caller must reject/abort. */
  registerFrame(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    state.framesSinceLastFinalize += 1;
    state.lastFrameAtMs = Date.now();
    return state.framesSinceLastFinalize <= MAX_FRAMES_PER_TURN;
  }

  resetTurnFrameCount(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.framesSinceLastFinalize = 0;
  }

  /**
   * Starts a brand-new generation for this session (a new turn, or an
   * interrupt) and returns its id. Any in-flight work still holding the
   * PREVIOUS id will see `state.generationId !== capturedId` on its next
   * check and abandon itself — see VoiceRuntimeState.generationId's doc.
   */
  newGeneration(sessionId: string): string | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    state.generationId = randomUUID();
    return state.generationId;
  }

  isCurrentGeneration(sessionId: string, generationId: string): boolean {
    return this.sessions.get(sessionId)?.generationId === generationId;
  }

  destroy(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.ttsAbortController?.abort();
      state.sttSession?.abort();
    }
    this.sessions.delete(sessionId);
  }
}
