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

  /**
   * BUG REGRESSION (found via real microphone test, Phase G): the original
   * implementation required an EXACT full-phrase match, so these two real,
   * correctly-transcribed spoken confirmations were both misclassified as
   * 'none' — which is what caused a duplicate pending_action to be created
   * instead of the original one being approved. See voice-turn-runner
   * .service.spec.ts for the full end-to-end reproduction.
   */
  it('classifies real naturally-spoken confirmations that are NOT exact whitelist matches', () => {
    expect(service.classify('Oui, je confirme.')).toBe('affirm');
    expect(service.classify('Je voulais bien confirmer.')).toBe('affirm');
    expect(service.classify('Je confirme.')).toBe('affirm');
    expect(service.classify('Oui, vas-y.')).toBe('affirm');
    expect(service.classify("C'est bon, merci.")).toBe('affirm');
  });

  it('classifies real naturally-spoken refusals that are not exact whitelist matches', () => {
    expect(service.classify('Non merci.')).toBe('deny');
    expect(service.classify("Non, annule ça s'il te plaît.")).toBe('deny');
    expect(service.classify('Laisse tomber.')).toBe('deny');
  });

  it('never classifies a short but unrelated sentence containing a generic word as a confirmation', () => {
    // "vas" alone (from "vas-tu") must NOT trigger 'vas-y'-style matching.
    expect(service.classify('Comment vas-tu ?')).toBe('none');
  });

  it('never classifies a long sentence as a confirmation, even if it contains a trigger word in passing', () => {
    expect(
      service.classify(
        "Oui je sais que je t'ai demandé ça hier mais en fait laisse tomber, parle-moi plutôt du temps qu'il fera demain",
      ),
    ).toBe('none');
  });

  it('an unrelated mistranscription (e.g. a different language due to language=auto) is never treated as a confirmation', () => {
    // The real STT mistranscription observed live ("Confío en ti." — Spanish
    // for "I trust you") — NOT special-cased, just correctly falls outside
    // both keyword lists.
    expect(service.classify('Confío en ti.')).toBe('none');
  });

  it('a transcript matching both affirmative and negative markers is treated as ambiguous, never guessed', () => {
    expect(service.classify('oui non')).toBe('none');
  });

  it('returns none for an empty or whitespace-only transcript', () => {
    expect(service.classify('')).toBe('none');
    expect(service.classify('   ')).toBe('none');
  });
});
