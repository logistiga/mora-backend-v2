import { describe, expect, it } from 'vitest';
import { AvatarStateService } from './avatar-state.service.js';

describe('AvatarStateService', () => {
  const service = new AvatarStateService();

  it('builds a confirmation-focused realtime state payload', () => {
    const payload = service.buildState({
      state: 'confirming',
      channel: 'voice',
      sessionId: 'session-1',
      conversationId: 'conv-1',
      pendingConfirmation: true,
    });

    expect(payload.expression).toBe('confirming');
    expect(payload.pendingConfirmation).toBe(true);
    expect(payload.canInterrupt).toBe(true);
  });

  it('switches to vision-focused expressions for multimodal channels', () => {
    const payload = service.buildExpression({ state: 'speaking', channel: 'voice_vision' });
    expect(payload.expression).toBe('vision_focus');
    expect(payload.channel).toBe('voice_vision');
  });

  it('builds a bounded viseme timeline for lip sync', () => {
    const payload = service.buildLipSyncPlan({ text: 'Bonjour Jean Dupont', channel: 'voice', enabled: true, voiceSpeed: 1 });
    expect(payload.mode).toBe('viseme_timeline');
    expect(payload.durationMs).toBeGreaterThan(0);
    expect(payload.cues.length).toBeGreaterThan(0);
    expect(payload.cues.every((cue) => cue.endMs > cue.startMs)).toBe(true);
  });
});
