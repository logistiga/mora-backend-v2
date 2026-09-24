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

  /** pendingActionId values proposed during this session that are still awaiting a spoken confirmation (AGENTS §23). */
  openPendingActionIds: Set<string>;

  speechEndedAtMs: number | null;
  isUserSpeaking: boolean;

  /** Basic audio-flood guard (AGENTS §26): total frames received since the last finalize(). */
  framesSinceLastFinalize: number;
  lastFrameAtMs: number;
}

const MAX_FRAMES_PER_TURN = 2000; // ~200-400s of audio at 100-200ms/frame — generous but bounded

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
      openPendingActionIds: new Set(),
      speechEndedAtMs: null,
      isUserSpeaking: false,
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

  destroy(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.ttsAbortController?.abort();
      state.sttSession?.abort();
    }
    this.sessions.delete(sessionId);
  }
}
