import { describe, expect, it } from 'vitest';
import { EndOfTurnService } from './end-of-turn.service.js';

describe('EndOfTurnService', () => {
  it('is not over immediately after VAD reports speech_ended', () => {
    const service = new EndOfTurnService();
    expect(service.isTurnOver(1000, 1050)).toBe(false);
  });

  it('is over once the confirm-silence window has elapsed', () => {
    const service = new EndOfTurnService();
    expect(service.isTurnOver(1000, 1400)).toBe(true);
  });
});
