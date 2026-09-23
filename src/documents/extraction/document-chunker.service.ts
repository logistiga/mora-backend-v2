import { Injectable } from '@nestjs/common';

export interface Chunk {
  chunkIndex: number;
  section?: string;
  content: string;
  tokenCount: number;
}

const MAX_CHUNK_CHARS = 1500;
const HEADING_PATTERN = /^(#{1,6}\s+.+|[A-Z][A-Z0-9 ,.'-]{4,80})$/;

/**
 * Structure-aware chunking (AGENTS Phase E §10): splits on paragraph/heading
 * boundaries rather than an arbitrary fixed character stride, and never
 * splits a paragraph across two chunks unless that single paragraph alone
 * exceeds the budget (then falls back to sentence boundaries only for that
 * paragraph). Each chunk keeps its most recent heading as `section` —
 * real, if simple, provenance (AGENTS §19).
 */
@Injectable()
export class DocumentChunkerService {
  chunk(text: string): Chunk[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const chunks: Chunk[] = [];
    let currentSection: string | undefined;
    let buffer: string[] = [];
    let bufferChars = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      const content = buffer.join('\n\n').trim();
      if (content.length > 0) {
        chunks.push({
          chunkIndex: chunks.length,
          section: currentSection,
          content,
          tokenCount: approximateTokenCount(content),
        });
      }
      buffer = [];
      bufferChars = 0;
    };

    for (const paragraph of paragraphs) {
      if (HEADING_PATTERN.test(paragraph) && paragraph.length < 120) {
        flush();
        currentSection = paragraph.replace(/^#+\s*/, '');
        continue;
      }

      if (paragraph.length > MAX_CHUNK_CHARS) {
        flush();
        for (const piece of splitLongParagraph(paragraph, MAX_CHUNK_CHARS)) {
          chunks.push({
            chunkIndex: chunks.length,
            section: currentSection,
            content: piece,
            tokenCount: approximateTokenCount(piece),
          });
        }
        continue;
      }

      if (bufferChars + paragraph.length > MAX_CHUNK_CHARS && buffer.length > 0) {
        flush();
      }
      buffer.push(paragraph);
      bufferChars += paragraph.length;
    }
    flush();

    return chunks;
  }
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      pieces.push(current.trim());
      current = '';
    }
    current += (current ? ' ' : '') + sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.length > 0 ? pieces : [paragraph.slice(0, maxChars)];
}

/** ~4 chars/token is a standard rough estimate for English/French text — good enough for budgeting, never billed on. */
function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
