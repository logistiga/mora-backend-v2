import { describe, expect, it } from 'vitest';
import { mapEvolutionStatus, shouldAdvance } from './whatsapp-status.util.js';

describe('mapEvolutionStatus', () => {
  it.each([
    ['SERVER_ACK', 'sent'],
    ['PENDING', 'sent'],
    ['DELIVERY_ACK', 'delivered'],
    ['READ', 'read'],
    ['PLAYED', 'read'],
    ['ERROR', 'failed'],
  ])('maps Evolution %s to %s', (input, expected) => {
    expect(mapEvolutionStatus(input)).toBe(expected);
  });

  it('ignores DELETED, unknown and non-string values', () => {
    expect(mapEvolutionStatus('DELETED')).toBeNull();
    expect(mapEvolutionStatus('SOMETHING_NEW')).toBeNull();
    expect(mapEvolutionStatus(undefined)).toBeNull();
    expect(mapEvolutionStatus(42)).toBeNull();
  });
});

describe('shouldAdvance', () => {
  it('moves forward sent -> delivered -> read', () => {
    expect(shouldAdvance('sent', 'delivered')).toBe(true);
    expect(shouldAdvance('delivered', 'read')).toBe(true);
  });

  it('never downgrades: a late delivery receipt cannot overwrite read', () => {
    expect(shouldAdvance('read', 'delivered')).toBe(false);
    expect(shouldAdvance('read', 'sent')).toBe(false);
  });

  it('a failure is recorded unless the message was already read', () => {
    expect(shouldAdvance('sent', 'failed')).toBe(true);
    expect(shouldAdvance('read', 'failed')).toBe(false);
  });

  it('accepts a first status on a message that has none yet', () => {
    expect(shouldAdvance(null, 'sent')).toBe(true);
  });
});
