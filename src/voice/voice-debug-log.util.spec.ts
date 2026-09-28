import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_VOICE_DEBUG_COUNTERS,
  MAX_VOICE_DEBUG_ENTRIES,
  getVoiceDebugState,
  resetVoiceDebug,
  voiceDebug,
} from './voice-debug-log.util.js';

describe('voiceDebug', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetVoiceDebug();
    debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    resetVoiceDebug();
  });

  it('never stores or logs transcript text, only its length', () => {
    const transcript = 'Mon code de carte est 4242 et je vis au 12 rue secrète';
    voiceDebug('transcript.final', { sessionId: 's1', text: transcript, transcript, sttLatencyMs: 12 });

    const [entry] = getVoiceDebugState().log;
    expect(entry).toMatchObject({
      event: 'transcript.final',
      sessionId: 's1',
      textLength: transcript.length,
      transcriptLength: transcript.length,
      sttLatencyMs: 12,
    });
    expect(entry).not.toHaveProperty('text');
    expect(entry).not.toHaveProperty('transcript');
    const logged = debugSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(logged).not.toContain('4242');
    expect(JSON.stringify(entry)).not.toContain('4242');
  });

  it('truncates long free strings and flattens objects', () => {
    voiceDebug('websocket_disconnected', { reason: 'r'.repeat(1000), nested: { text: 'secret speech' } });
    const [entry] = getVoiceDebugState().log;
    expect(String(entry.reason).length).toBeLessThanOrEqual(121);
    expect(entry.nested).toBe('[object]');
    expect(JSON.stringify(entry)).not.toContain('secret speech');
  });

  it('keeps the timeline bounded to the most recent entries', () => {
    const total = MAX_VOICE_DEBUG_ENTRIES + 250;
    for (let i = 0; i < total; i++) voiceDebug('tick', { i });
    const { log } = getVoiceDebugState();
    expect(log).toHaveLength(MAX_VOICE_DEBUG_ENTRIES);
    expect(log[0].i).toBe(total - MAX_VOICE_DEBUG_ENTRIES);
    expect(log.at(-1)?.i).toBe(total - 1);
  });

  it('aggregates counters without adding timeline entries, with a bounded set of names', () => {
    voiceDebug('counter_incremented', { counter: 'frames' });
    voiceDebug('counter_incremented', { counter: 'frames', delta: 4 });
    for (let i = 0; i < MAX_VOICE_DEBUG_COUNTERS + 50; i++) {
      voiceDebug('counter_incremented', { counter: `c${i}` });
    }
    const { counters, log } = getVoiceDebugState();
    expect(counters.frames).toBe(5);
    expect(Object.keys(counters)).toHaveLength(MAX_VOICE_DEBUG_COUNTERS);
    expect(log).toHaveLength(0);
  });
});
