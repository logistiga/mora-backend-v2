import { describe, expect, it } from 'vitest';
import { EnergyVadService } from './energy-vad.service.js';

function silentFrame(samples = 320): Buffer {
  return Buffer.alloc(samples * 2, 0);
}

function loudFrame(samples = 320, amplitude = 8000): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

describe('EnergyVadService', () => {
  it('does not report speech_started on a single silent frame', () => {
    const vad = new EnergyVadService();
    expect(vad.process(silentFrame(), 0)).toBeNull();
  });

  it('reports speech_started once loud frames persist past the start window', () => {
    const vad = new EnergyVadService();
    expect(vad.process(loudFrame(), 0)).toBeNull(); // first loud frame: not yet confirmed
    const event = vad.process(loudFrame(), 150); // 150ms later, still loud -> confirmed
    expect(event).toEqual({ type: 'speech_started', atMs: 150 });
  });

  it('does not flip to speech_ended on one brief silent frame (avoids cutting the user off mid-word)', () => {
    const vad = new EnergyVadService();
    vad.process(loudFrame(), 0);
    vad.process(loudFrame(), 150); // now speaking
    const event = vad.process(silentFrame(), 200); // single brief silence
    expect(event).toBeNull();
  });

  it('reports speech_ended only after the full silence window elapses', () => {
    const vad = new EnergyVadService();
    vad.process(loudFrame(), 0);
    vad.process(loudFrame(), 150); // speaking confirmed
    vad.process(silentFrame(), 200); // silence starts
    expect(vad.process(silentFrame(), 400)).toBeNull(); // not yet 600ms
    const event = vad.process(silentFrame(), 900); // 700ms of silence -> ended
    expect(event).toEqual({ type: 'speech_ended', atMs: 900 });
  });

  it('reset() clears state so a stale speaking flag does not leak into the next turn', () => {
    const vad = new EnergyVadService();
    vad.process(loudFrame(), 0);
    vad.process(loudFrame(), 150);
    vad.reset();
    expect(vad.process(silentFrame(), 200)).toBeNull();
  });
});
