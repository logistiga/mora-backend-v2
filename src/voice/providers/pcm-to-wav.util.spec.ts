import { describe, expect, it } from 'vitest';
import { pcm16ToWav } from './pcm-to-wav.util.js';

describe('pcm16ToWav', () => {
  it('produces a valid RIFF/WAVE header with correct sizes', () => {
    const pcm = Buffer.alloc(320, 1);
    const wav = pcm16ToWav(pcm, 16000, 1);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.length).toBe(44 + pcm.length);
  });

  it('handles empty PCM input without throwing', () => {
    const wav = pcm16ToWav(Buffer.alloc(0), 16000, 1);
    expect(wav.length).toBe(44);
  });
});
