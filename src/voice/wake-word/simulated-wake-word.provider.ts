import { Injectable } from '@nestjs/common';
import type { WakeWordDetectionResult, WakeWordDetectorInterface } from './wake-word.interface.js';

/**
 * SIMULATED / TEST-ONLY. Never tested against real microphone audio
 * containing the word "Mora" — `isRealAudioTested` is honestly `false`.
 * Exists only so `mode: 'wake_word'` has a concrete (mockable) contract to
 * exercise in tests; real wake-word activation for Phase F ships as
 * push_to_talk (client-driven `session.start`) and continuous_session
 * (client keeps the session open) — both of which do NOT need this
 * detector at all, since they don't require on-device always-listening
 * wake-word audio. `mode: 'wake_word'` is accepted by the API but resolves
 * to this simulated detector, which always returns not-detected, until a
 * real client-side/edge detector exists in a later phase.
 */
@Injectable()
export class SimulatedWakeWordProvider implements WakeWordDetectorInterface {
  readonly detectorName = 'simulated-noop-v1';
  readonly isRealAudioTested = false;

  detect(_frame: Buffer): WakeWordDetectionResult {
    return { detected: false, confidence: 0 };
  }
}
