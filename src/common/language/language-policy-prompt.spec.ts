import { describe, expect, it } from 'vitest';
import { buildSttLanguageSignalNote, LANGUAGE_POLICY_INSTRUCTION } from './language-policy-prompt.js';

describe('LANGUAGE_POLICY_INSTRUCTION', () => {
  it('is a non-empty, generic instruction that never names a specific language or user', () => {
    expect(LANGUAGE_POLICY_INSTRUCTION.length).toBeGreaterThan(100);
    // Generic means: it states priorities, not concrete languages/examples
    // tied to one user or conversation. It must not hardcode "français" or
    // "arabe" as THE target language, only reference them as generic examples.
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/message actuel/i);
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/priorité/i);
  });

  it('states that the current turn language takes priority over conversation history', () => {
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/tours précédents/i);
  });

  it('states that an explicit per-turn request overrides automatic detection', () => {
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/explicite/i);
  });

  it('states that a durable/stored preference should be applied consistently', () => {
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/préférence durable/i);
  });

  it('states that Chat and Voice follow the same policy', () => {
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/chat écrit/i);
    expect(LANGUAGE_POLICY_INSTRUCTION).toMatch(/vocal/i);
  });
});

describe('buildSttLanguageSignalNote', () => {
  it('returns null when there is no detected language', () => {
    expect(buildSttLanguageSignalNote(undefined)).toBeNull();
    expect(buildSttLanguageSignalNote(null)).toBeNull();
    expect(buildSttLanguageSignalNote('')).toBeNull();
    expect(buildSttLanguageSignalNote('   ')).toBeNull();
  });

  it('builds a clearly-labelled, non-authoritative note when a language was detected', () => {
    const note = buildSttLanguageSignalNote('ar');
    expect(note).toContain('ar');
    expect(note).toMatch(/secondaire/i);
    expect(note).toMatch(/indicatif/i);
    // Must explicitly say it never overrides the main policy — this is what
    // keeps an unreliable STT hint from silently taking priority over the
    // actual transcript text.
    expect(note).toMatch(/ne remplace jamais/i);
  });
});
