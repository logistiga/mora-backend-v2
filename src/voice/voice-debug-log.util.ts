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
 * logs raw audio, secrets, tokens, or user speech content: content-bearing
 * fields (`text`, `transcript`, …) are replaced by their length before the
 * entry is stored or logged, and other strings are truncated.
 *
 * The in-memory timeline is a ring buffer capped at MAX_VOICE_DEBUG_ENTRIES
 * (oldest entries dropped) and the counters map at MAX_VOICE_DEBUG_COUNTERS
 * names, so a long-running process never grows either without bound.
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
export const MAX_VOICE_DEBUG_ENTRIES = 500;
export const MAX_VOICE_DEBUG_COUNTERS = 100;
const MAX_STRING_LENGTH = 120;
const CONTENT_KEYS = new Set(['text', 'transcript', 'content', 'message', 'response', 'prompt']);

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

export function getVoiceDebugState(): Readonly<VoiceDebugState> {
  return getState();
}

host.__resetVoiceDebug ??= resetVoiceDebug;

export function voiceDebug(event: string, ctx: Record<string, unknown> = {}): void {
  const state = getState();
  const ts = Date.now();

  if (event === 'counter_incremented') {
    const counterName = typeof ctx.counter === 'string' ? truncate(ctx.counter) : 'unknown';
    const delta = typeof ctx.delta === 'number' ? ctx.delta : 1;
    if (counterName in state.counters || Object.keys(state.counters).length < MAX_VOICE_DEBUG_COUNTERS) {
      state.counters[counterName] = (state.counters[counterName] ?? 0) + delta;
    }
    return;
  }

  const entry: VoiceDebugEntry = { ...sanitizeContext(ctx), event, ts };
  state.log.push(entry);
  if (state.log.length > MAX_VOICE_DEBUG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_VOICE_DEBUG_ENTRIES);
  }
  logger.debug(JSON.stringify(entry));
}

function sanitizeContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (CONTENT_KEYS.has(key)) {
      safe[`${key}Length`] = typeof value === 'string' ? value.length : null;
    } else if (typeof value === 'string') {
      safe[key] = truncate(value);
    } else if (value == null || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    } else {
      safe[key] = '[object]';
    }
  }
  return safe;
}

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}
