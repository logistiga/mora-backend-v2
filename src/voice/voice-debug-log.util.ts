import { Logger } from '@nestjs/common';

interface VoiceDebugEntry {
  event: string;
  ts: number;
  [key: string]: unknown;
}

interface VoiceDebugState {
  log: VoiceDebugEntry[];
  counters: Record<string, number>;
}

type VoiceDebugHost = typeof globalThis & {
  __voiceDebug?: VoiceDebugState;
  __resetVoiceDebug?: () => void;
};

/**
 * TEMPORARY DEBUG INSTRUMENTATION (Phase G barge-in investigation).
 * Structured, correlated event logging across the voice backend — never
 * logs raw audio, secrets, or tokens. Transcript text may be logged only
 * where explicitly requested for this investigation.
 *
 * The log stays readable by keeping high-volume counters aggregated in
 * `__voiceDebug.counters` instead of appending every increment event to the
 * timeline. `globalThis.__resetVoiceDebug()` resets both the timeline and
 * the counters; in a browser context this is reachable as
 * `window.__resetVoiceDebug()`.
 *
 * To remove after the investigation: delete this file and its call sites
 * (all reachable by searching for `voiceDebug(`).
 */
const logger = new Logger('VOICE_DEBUG');
const host = globalThis as VoiceDebugHost;

function makeEmptyState(): VoiceDebugState {
  return { log: [], counters: {} };
}

function getState(): VoiceDebugState {
  host.__voiceDebug ??= makeEmptyState();
  return host.__voiceDebug;
}

export function resetVoiceDebug(): void {
  host.__voiceDebug = makeEmptyState();
}

host.__resetVoiceDebug ??= resetVoiceDebug;

export function voiceDebug(event: string, ctx: Record<string, unknown> = {}): void {
  const state = getState();
  const ts = Date.now();
  const entry: VoiceDebugEntry = { event, ts, ...ctx };

  if (event === 'counter_incremented') {
    const counterName = typeof ctx.counter === 'string' ? ctx.counter : 'unknown';
    const delta = typeof ctx.delta === 'number' ? ctx.delta : 1;
    state.counters[counterName] = (state.counters[counterName] ?? 0) + delta;
    return;
  }

  state.log.push(entry);
  logger.debug(JSON.stringify(entry));
}
