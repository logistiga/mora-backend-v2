import { describe, expect, it } from 'vitest';
import { normalizeTag } from './tag-normalization.util.js';

describe('normalizeTag', () => {
  it('lowercases and trims', () => {
    expect(normalizeTag('  Facture  ')).toBe('facture');
  });

  it('collapses spaces/punctuation into single hyphens', () => {
    expect(normalizeTag('Client Total')).toBe('client-total');
    expect(normalizeTag('client  total')).toBe('client-total');
    expect(normalizeTag('Client-Total')).toBe('client-total');
  });

  it('strips accents so equivalent tags collide (dedup)', () => {
    expect(normalizeTag('Facturé')).toBe('facture');
    expect(normalizeTag('Facture')).toBe('facture');
  });

  it('caps length to avoid unbounded tag explosion', () => {
    const long = 'a'.repeat(100);
    expect(normalizeTag(long).length).toBeLessThanOrEqual(50);
  });
});
