import { describe, expect, it } from 'vitest';
import { maskJid } from './webhook-diagnostics.util.js';

describe('maskJid', () => {
  it('keeps only the last four digits of the user part and the domain', () => {
    expect(maskJid('24162222111@s.whatsapp.net')).toBe('*******2111@s.whatsapp.net');
  });

  it('returns null for missing values and never echoes a non-string', () => {
    expect(maskJid(undefined)).toBeNull();
    expect(maskJid('')).toBeNull();
    expect(maskJid(42)).toBeNull();
  });
});
