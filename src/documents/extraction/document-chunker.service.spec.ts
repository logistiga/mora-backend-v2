import { describe, expect, it } from 'vitest';
import { DocumentChunkerService } from './document-chunker.service.js';

describe('DocumentChunkerService', () => {
  const chunker = new DocumentChunkerService();

  it('splits on paragraph boundaries, never mid-paragraph for short text', () => {
    const text = 'Premier paragraphe.\n\nDeuxième paragraphe.\n\nTroisième paragraphe.';
    const chunks = chunker.chunk(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain('Premier paragraphe');
  });

  it('tracks the most recent heading as the chunk section', () => {
    const text = '# Introduction\n\nCeci est le texte sous le titre.\n\n# Conclusion\n\nCeci est la conclusion.';
    const chunks = chunker.chunk(text);
    const introChunk = chunks.find((c) => c.content.includes('sous le titre'));
    const conclusionChunk = chunks.find((c) => c.content.includes('la conclusion'));
    expect(introChunk?.section).toBe('Introduction');
    expect(conclusionChunk?.section).toBe('Conclusion');
  });

  it('never produces a chunk larger than the configured budget for a single long paragraph', () => {
    const longParagraph = 'Phrase numéro un. '.repeat(200); // > 1500 chars, one giant paragraph
    const chunks = chunker.chunk(longParagraph);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1600); // small slack for sentence-boundary rounding
    }
  });

  it('assigns sequential chunkIndex starting at 0', () => {
    const text = 'A.\n\nB.\n\nC.';
    const chunks = chunker.chunk(text);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('returns an empty array for empty/whitespace-only text', () => {
    expect(chunker.chunk('   \n\n  ')).toHaveLength(0);
  });
});
