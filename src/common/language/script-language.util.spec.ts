import { describe, expect, it } from 'vitest';
import { detectScriptLanguage } from './script-language.util.js';

describe('detectScriptLanguage', () => {
  it('detects Arabic script', () => {
    expect(detectScriptLanguage('مرحباً كيف حالك؟')).toBe('ar');
  });

  it('detects the common Latin-transliterated Arabic/Darija greeting "Salam" (the reported bug fixture)', () => {
    expect(detectScriptLanguage('Salam.')).toBe('ar');
    expect(detectScriptLanguage('Salam, comment ça va ?')).toBe('ar');
  });

  it('detects Latin-script Darija via digit-substituted phonemes', () => {
    expect(detectScriptLanguage('kifach 3andek lyoum')).toBe('darija');
  });

  it('detects French via common stopwords', () => {
    expect(detectScriptLanguage('Bonjour, comment vas-tu ?')).toBe('fr');
  });

  it('detects English via common stopwords', () => {
    expect(detectScriptLanguage('Hello, how are you?')).toBe('en');
  });

  it('returns unknown for empty or unrecognizable input, never guesses confidently', () => {
    expect(detectScriptLanguage('')).toBe('unknown');
    expect(detectScriptLanguage('   ')).toBe('unknown');
    expect(detectScriptLanguage('xyz123')).toBe('unknown');
  });
});
