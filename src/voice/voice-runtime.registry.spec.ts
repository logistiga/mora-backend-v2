import { describe, expect, it } from 'vitest';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';

const baseParams = {
  sessionId: 'session-1',
  userId: 'user-1',
  scope: 'personal' as const,
  space: 'default',
  language: 'fr',
  conversationId: 'conv-1',
};

describe('VoiceRuntimeRegistry', () => {
  it('creates and retrieves per-session runtime state', () => {
    const registry = new VoiceRuntimeRegistry();
    registry.create(baseParams);
    const state = registry.get('session-1');
    expect(state?.userId).toBe('user-1');
    expect(state?.openPendingActionIds.size).toBe(0);
  });

  it('destroy() aborts any in-flight TTS/STT and removes the session', () => {
    const registry = new VoiceRuntimeRegistry();
    const state = registry.create(baseParams);
    const controller = new AbortController();
    state.ttsAbortController = controller;
    registry.destroy('session-1');
    expect(controller.signal.aborted).toBe(true);
    expect(registry.get('session-1')).toBeUndefined();
  });

  it('registerFrame rejects audio once the per-turn frame cap is exceeded (flood guard)', () => {
    const registry = new VoiceRuntimeRegistry();
    registry.create(baseParams);
    let allowed = true;
    for (let i = 0; i < 2001; i++) {
      allowed = registry.registerFrame('session-1');
    }
    expect(allowed).toBe(false);
  });

  it('resetTurnFrameCount clears the flood-guard counter for the next turn', () => {
    const registry = new VoiceRuntimeRegistry();
    registry.create(baseParams);
    for (let i = 0; i < 100; i++) registry.registerFrame('session-1');
    registry.resetTurnFrameCount('session-1');
    expect(registry.get('session-1')?.framesSinceLastFinalize).toBe(0);
  });

  it('two independent sessions get two independent VAD instances (no cross-user state leak)', () => {
    const registry = new VoiceRuntimeRegistry();
    const a = registry.create({ ...baseParams, sessionId: 'a', userId: 'user-a' });
    const b = registry.create({ ...baseParams, sessionId: 'b', userId: 'user-b' });
    expect(a.vad).not.toBe(b.vad);
  });

  /**
   * Phase G real-mic bug fix (concurrent assistant responses): a session
   * gets a fresh generationId on creation and every subsequent bump. This is
   * the primitive the gateway/turn-runner use to guarantee at most one
   * active generation per session.
   */
  describe('generation tracking', () => {
    it('assigns a generationId on creation', () => {
      const registry = new VoiceRuntimeRegistry();
      const state = registry.create(baseParams);
      expect(typeof state.generationId).toBe('string');
      expect(state.generationId.length).toBeGreaterThan(0);
    });

    it('newGeneration() returns a different id each time (9. double interrupt is idempotent, never collides)', () => {
      const registry = new VoiceRuntimeRegistry();
      registry.create(baseParams);
      const first = registry.newGeneration('session-1');
      const second = registry.newGeneration('session-1');
      const third = registry.newGeneration('session-1');
      expect(first).not.toBe(second);
      expect(second).not.toBe(third);
    });

    it('newGeneration() on an unknown session returns null rather than throwing', () => {
      const registry = new VoiceRuntimeRegistry();
      expect(registry.newGeneration('does-not-exist')).toBeNull();
    });

    it('isCurrentGeneration() reflects the latest bump', () => {
      const registry = new VoiceRuntimeRegistry();
      const state = registry.create(baseParams);
      const originalGen = state.generationId;
      expect(registry.isCurrentGeneration('session-1', originalGen)).toBe(true);

      const newGen = registry.newGeneration('session-1')!;
      expect(registry.isCurrentGeneration('session-1', originalGen)).toBe(false); // 6/7. an old id is no longer current
      expect(registry.isCurrentGeneration('session-1', newGen)).toBe(true);
    });

    it('5 successive generation bumps never collide and always leave exactly one current id', () => {
      const registry = new VoiceRuntimeRegistry();
      registry.create(baseParams);
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) ids.add(registry.newGeneration('session-1')!);
      expect(ids.size).toBe(5); // all distinct
      expect(registry.isCurrentGeneration('session-1', [...ids][4])).toBe(true);
    });
  });
});
