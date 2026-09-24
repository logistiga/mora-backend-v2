/**
 * Phase F — Real-Time Voice Engine: shared types.
 *
 * Core principle (AGENTS Phase F §0): voice is a CHANNEL, not a new brain.
 * Every type here exists to move audio in/out and to carry a transcript to
 * the EXISTING MoraOrchestratorService — never to reimplement routing,
 * memory, documents, or tools for voice.
 */

/** VoiceSession state machine states (AGENTS Phase F §4). */
export const VOICE_SESSION_STATES = [
  'created',
  'listening',
  'user_speaking',
  'transcribing',
  'thinking',
  'assistant_speaking',
  'interrupted',
  'paused',
  'ended',
  'error',
] as const;
export type VoiceSessionState = (typeof VOICE_SESSION_STATES)[number];

/** Legal transitions out of each state. Anything not listed is rejected. */
export const VOICE_STATE_TRANSITIONS: Record<VoiceSessionState, VoiceSessionState[]> = {
  created: ['listening', 'ended', 'error'],
  listening: ['user_speaking', 'paused', 'ended', 'error'],
  user_speaking: ['transcribing', 'listening', 'ended', 'error'],
  transcribing: ['thinking', 'listening', 'ended', 'error'],
  thinking: ['assistant_speaking', 'listening', 'ended', 'error'],
  assistant_speaking: ['listening', 'interrupted', 'ended', 'error'],
  interrupted: ['listening', 'user_speaking', 'ended', 'error'],
  paused: ['listening', 'ended', 'error'],
  ended: [],
  error: ['listening', 'ended'],
};

export const VOICE_MODES = ['push_to_talk', 'wake_word', 'continuous_session'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const VOICE_TURN_STATUSES = ['in_progress', 'completed', 'interrupted', 'failed'] as const;
export type VoiceTurnStatus = (typeof VOICE_TURN_STATUSES)[number];

export const SUPPORTED_VOICE_LANGUAGES = ['auto', 'fr', 'en', 'ar', 'darija'] as const;
export type SupportedVoiceLanguage = (typeof SUPPORTED_VOICE_LANGUAGES)[number];

/**
 * Audio format contract (AGENTS Phase F §9): PCM16 little-endian, mono,
 * 16kHz — the smallest common denominator every browser MediaRecorder /
 * AudioWorklet setup and every STT provider used here (OpenAI Whisper)
 * accepts without server-side resampling. Chunk duration is left to the
 * client (recommended 100-300ms); the server only requires each binary
 * frame to be raw PCM16 bytes (even length).
 */
export const VOICE_AUDIO_FORMAT = {
  encoding: 'pcm16le',
  sampleRateHz: 16000,
  channels: 1,
  recommendedChunkMs: 200,
} as const;

// ---------------------------------------------------------------------------
// Client -> Server event protocol (versioned; AGENTS Phase F §6)
// ---------------------------------------------------------------------------
export const VOICE_PROTOCOL_VERSION = 1;

export type ClientToServerEventType =
  | 'session.start' // { sessionId, protocolVersion }
  | 'audio.chunk' // binary PCM16 frame
  | 'audio.end' // user explicitly stopped speaking (push-to-talk release)
  | 'session.interrupt' // user wants to barge in / stop assistant speech
  | 'session.pause'
  | 'session.resume'
  | 'session.end';

export type ServerToClientEventType =
  | 'session.ready' // { sessionId, state, protocolVersion }
  | 'transcript.partial' // { text } — UI display only, never triggers the Orchestrator
  | 'transcript.final' // { text, turnId }
  | 'assistant.thinking.started'
  | 'assistant.speaking.started' // prepared for Phase H avatar sync — no avatar logic here
  | 'audio.out.chunk' // binary TTS audio frame
  | 'assistant.speaking.ended'
  | 'assistant.expression' // optional, prepared for Phase H — never emitted with real content in Phase F
  | 'action.pending_confirmation' // { pendingActionId, tool, securityLevel, summary }
  | 'action.executed' // { pendingActionId, toolName }
  | 'action.clarification_needed' // { candidateCount } — ambiguous "oui" with >1 open pending action
  | 'session.state_changed' // { state }
  | 'session.interrupted'
  | 'session.ended'
  | 'latency.metrics' // { ...VoiceTurnLatency }
  | 'error'; // { code, message } — sanitized, never a raw provider error

export interface VoiceTurnLatency {
  vadToSttMs?: number;
  sttLatencyMs?: number;
  llmLatencyMs?: number;
  ttsFirstByteMs?: number;
  speechEndToFirstAudioMs?: number;
  totalLatencyMs?: number;
}
