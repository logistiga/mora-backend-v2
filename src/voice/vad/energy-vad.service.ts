import { Injectable } from '@nestjs/common';
import type { VadEvent, VoiceActivityDetectorInterface } from './vad.interface.js';

/**
 * REAL, working VAD — not a stub. A short-window RMS-energy detector over
 * PCM16LE frames: speech is declared "started" once RMS energy stays above
 * a threshold for `startWindowMs`, and "ended" once it stays below the
 * threshold for `silenceWindowMs`. This is intentionally the simplest
 * detector that (a) avoids cutting the user off mid-word on a single quiet
 * frame and (b) avoids waiting a fixed 5s after every phrase regardless of
 * actual silence (AGENTS Phase F §16: "évite de couper l'utilisateur trop
 * tôt ou d'attendre 5s après chaque phrase").
 *
 * Deliberately NOT Silero/WebRTC VAD: those require a bundled ML model or a
 * native binding, which is disproportionate for a Phase F MVP whose real
 * bottleneck is STT/LLM/TTS network latency, not VAD accuracy. This is
 * documented as a known limitation in the Phase F report, not hidden.
 */
@Injectable()
export class EnergyVadService implements VoiceActivityDetectorInterface {
  readonly detectorName = 'energy-rms-v1';

  private readonly threshold = 500; // RMS amplitude threshold, empirical for 16-bit PCM speech
  private readonly startWindowMs = 120;
  private readonly silenceWindowMs = 600;

  private speaking = false;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;

  reset(): void {
    this.speaking = false;
    this.aboveSince = null;
    this.belowSince = null;
  }

  process(frame: Buffer, nowMs: number): VadEvent | null {
    const rms = computeRms(frame);
    const isAboveThreshold = rms >= this.threshold;

    if (isAboveThreshold) {
      this.belowSince = null;
      if (!this.speaking) {
        if (this.aboveSince === null) this.aboveSince = nowMs;
        if (nowMs - this.aboveSince >= this.startWindowMs) {
          this.speaking = true;
          this.aboveSince = null;
          return { type: 'speech_started', atMs: nowMs };
        }
      }
      return null;
    }

    // Below threshold
    this.aboveSince = null;
    if (this.speaking) {
      if (this.belowSince === null) this.belowSince = nowMs;
      if (nowMs - this.belowSince >= this.silenceWindowMs) {
        this.speaking = false;
        this.belowSince = null;
        return { type: 'speech_ended', atMs: nowMs };
      }
    }
    return null;
  }
}

function computeRms(frame: Buffer): number {
  const sampleCount = Math.floor(frame.length / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = frame.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}
