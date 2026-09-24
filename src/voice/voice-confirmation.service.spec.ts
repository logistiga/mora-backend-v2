import { describe, expect, it } from 'vitest';
import { VoiceConfirmationService } from './voice-confirmation.service.js';

describe('VoiceConfirmationService', () => {
  const service = new VoiceConfirmationService();

  it('classifies clear affirmative phrases', () => {
    expect(service.classify('Oui')).toBe('affirm');
    expect(service.classify('oui, confirme')).toBe('affirm');
    expect(service.classify("D'accord")).toBe('affirm');
    expect(service.classify('OK.')).toBe('affirm');
  });

  it('classifies clear negative phrases', () => {
    expect(service.classify('Non')).toBe('deny');
    expect(service.classify('Annule')).toBe('deny');
    expect(service.classify('Stop')).toBe('deny');
  });

  it('classifies an unrelated new request as none, never guessing a confirmation', () => {
    expect(service.classify("Rappelle-moi d'appeler Jean demain à neuf heures.")).toBe('none');
    expect(service.classify('Quel temps fait-il ?')).toBe('none');
  });

  it('is accent/case/punctuation-insensitive for the whitelist', () => {
    expect(service.classify('  OUI !  ')).toBe('affirm');
    expect(service.classify('Confirmé.')).toBe('affirm');
  });
});
