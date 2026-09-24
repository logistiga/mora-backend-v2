/**
 * Wake-word contract (AGENTS Phase F §29/§30). IMPORTANT HONESTY NOTE: no
 * real microphone-always-on wake-word detector is built in Phase F. Real
 * wake-word detection ("Mora") belongs on the DEVICE (continuous local
 * audio listening is a client/edge concern — a backend WebSocket session
 * only exists once the client has already decided to start streaming), so
 * this interface defines the CONTRACT a future client-side or
 * server-assisted detector must satisfy, and ships one explicitly
 * SIMULATED implementation for tests only. It must never be presented as
 * a working microphone-based detector (AGENTS §30: "ne prétend jamais
 * avoir un vrai détecteur si non construit").
 */
export interface WakeWordDetectionResult {
  detected: boolean;
  confidence: number;
}

export interface WakeWordDetectorInterface {
  readonly detectorName: string;
  /** true only for a detector that has actually been validated against real audio containing the wake word. */
  readonly isRealAudioTested: boolean;
  detect(frame: Buffer): WakeWordDetectionResult;
}
