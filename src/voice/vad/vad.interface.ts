/**
 * Voice Activity Detector contract (AGENTS Phase F §16/§17). Phase F ships
 * one real, honestly-scoped implementation (EnergyVadService — a
 * short-window RMS energy detector over PCM16 frames), not a timer-only
 * fixed-delay hack and not Silero/WebRTC VAD (out of scope for the MVP, but
 * this interface is what lets either swap in later without touching the
 * gateway or EndOfTurnService).
 */
export interface VadEvent {
  type: 'speech_started' | 'speech_ended';
  atMs: number;
}

export interface VoiceActivityDetectorInterface {
  readonly detectorName: string;
  /** Resets internal state for a new turn. */
  reset(): void;
  /** Feed one PCM16LE frame; returns a VAD event if a transition just occurred, else null. */
  process(frame: Buffer, nowMs: number): VadEvent | null;
}
