import { describe, expect, it } from 'vitest';
import { EnergyVadService } from './energy-vad.service.js';

/** Constant-amplitude PCM16LE frame: RMS equals the amplitude. */
function frame(amplitude: number): Buffer {
  const buf = Buffer.alloc(320);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(amplitude, i);
  return buf;
}

/** Feeds frames every 50ms and returns the time of the first speech_started, if any. */
function firstStartAt(vad: EnergyVadService, amplitude: number, assistantSpeaking: boolean, untilMs: number): number | null {
  for (let t = 0; t <= untilMs; t += 50) {
    if (vad.process(frame(amplitude), t, assistantSpeaking)?.type === 'speech_started') return t;
  }
  return null;
}

describe('EnergyVadService barge-in threshold', () => {
  it('starts on normal speech when the assistant is silent', () => {
    expect(firstStartAt(new EnergyVadService(), 800, false, 500)).not.toBeNull();
  });

  it('ignores moderate echo of the assistant voice while it is speaking', () => {
    expect(firstStartAt(new EnergyVadService(), 800, true, 1000)).toBeNull();
  });

  it('still detects a clear, sustained interruption while the assistant speaks', () => {
    const startAt = firstStartAt(new EnergyVadService(), 2500, true, 1000);
    expect(startAt).not.toBeNull();
    expect(startAt).toBeGreaterThanOrEqual(450);
  });
});
