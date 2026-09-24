import { describe, expect, it } from 'vitest';
import { VOICE_STATE_TRANSITIONS, type VoiceSessionState } from './voice.types.js';

describe('VOICE_STATE_TRANSITIONS (state machine)', () => {
  it('allows the full happy-path turn cycle', () => {
    const path: VoiceSessionState[] = [
      'created',
      'listening',
      'user_speaking',
      'transcribing',
      'thinking',
      'assistant_speaking',
      'listening',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(VOICE_STATE_TRANSITIONS[path[i]]).toContain(path[i + 1]);
    }
  });

  it('allows barge-in: assistant_speaking -> interrupted -> listening/user_speaking', () => {
    expect(VOICE_STATE_TRANSITIONS.assistant_speaking).toContain('interrupted');
    expect(VOICE_STATE_TRANSITIONS.interrupted).toContain('listening');
    expect(VOICE_STATE_TRANSITIONS.interrupted).toContain('user_speaking');
  });

  it('rejects an illegal jump from created straight to assistant_speaking', () => {
    expect(VOICE_STATE_TRANSITIONS.created).not.toContain('assistant_speaking');
  });

  it('rejects any transition out of ended (terminal state)', () => {
    expect(VOICE_STATE_TRANSITIONS.ended).toEqual([]);
  });

  it('allows recovering from error back into listening, but not directly resuming mid-turn states', () => {
    expect(VOICE_STATE_TRANSITIONS.error).toContain('listening');
    expect(VOICE_STATE_TRANSITIONS.error).not.toContain('assistant_speaking');
  });

  it('every state has a path to ended', () => {
    for (const [state, transitions] of Object.entries(VOICE_STATE_TRANSITIONS)) {
      if (state === 'ended') continue;
      expect(transitions).toContain('ended');
    }
  });
});
