import { describe, expect, it } from 'vitest';
import { SimulatedWakeWordProvider } from './simulated-wake-word.provider.js';

describe('SimulatedWakeWordProvider', () => {
  it('honestly declares itself as not tested against real audio', () => {
    const provider = new SimulatedWakeWordProvider();
    expect(provider.isRealAudioTested).toBe(false);
  });

  it('never reports a detection (no real detector exists in Phase F)', () => {
    const provider = new SimulatedWakeWordProvider();
    const result = provider.detect(Buffer.alloc(320));
    expect(result.detected).toBe(false);
  });
});
