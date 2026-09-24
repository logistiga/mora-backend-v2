import { describe, expect, it } from 'vitest';
import { splitIntoSentenceChunks } from './sentence-buffer.util.js';

describe('splitIntoSentenceChunks', () => {
  it('returns an empty array for empty/whitespace-only input', () => {
    expect(splitIntoSentenceChunks('')).toEqual([]);
    expect(splitIntoSentenceChunks('   ')).toEqual([]);
  });

  it('splits multiple sentences at sentence boundaries', () => {
    const chunks = splitIntoSentenceChunks(
      "Bonjour Mora. Je te rappelle d'appeler Jean demain à neuf heures. Merci beaucoup pour ton aide précieuse.",
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toContain('Bonjour Mora.');
  });

  it('merges very short sentences below the minimum chunk length rather than emitting tiny fragments', () => {
    const chunks = splitIntoSentenceChunks('Oui. Bien sûr, je vais faire cela tout de suite pour vous.', 15);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
    // "Oui." alone (4 chars) must have been merged into the next chunk, not emitted standalone.
    expect(chunks).not.toContain('Oui.');
  });

  it('returns the whole text as one chunk when it has no sentence boundary', () => {
    expect(splitIntoSentenceChunks('Bonjour tout le monde')).toEqual(['Bonjour tout le monde']);
  });
});
