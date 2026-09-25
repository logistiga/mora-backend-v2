import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleVisionProvider } from './openai-compatible-vision.provider.js';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

describe('OpenAiCompatibleVisionProvider', () => {
  const provider = new OpenAiCompatibleVisionProvider();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a JSON multimodal response into summary, OCR text, and structured data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          model: 'gpt-4.1-mini',
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Une facture visible avec un total TTC.',
                  extractedText: 'FACTURE\nTOTAL 120 EUR',
                  structuredData: { total: '120 EUR' },
                }),
              },
            },
          ],
        }),
      })),
    );

    const result = await provider.analyze(
      {
        providerRowId: 'p1',
        provider: 'openai',
        kind: 'vision',
        model: 'gpt-4.1-mini',
        apiKey: 'sk-test',
        capabilities: { vision: true, jsonMode: true },
        settings: {},
      },
      {
        prompt: 'Analyse cette image',
        images: [{ mimeType: 'image/png', buffer: PNG_1X1 }],
      },
    );

    expect(result.summary).toContain('facture');
    expect(result.extractedText).toContain('TOTAL 120 EUR');
    expect(result.structuredData).toEqual({ total: '120 EUR' });
    expect(result.totalTokens).toBe(25);
  });

  it('falls back to raw text when the provider does not return valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Description libre sans JSON' } }],
        }),
      })),
    );

    const result = await provider.analyze(
      {
        providerRowId: 'p1',
        provider: 'openai',
        kind: 'vision',
        model: 'gpt-4.1-mini',
        capabilities: { vision: true },
        settings: {},
      },
      { prompt: 'Analyse', images: [{ mimeType: 'image/png', buffer: PNG_1X1 }] },
    );

    expect(result.summary).toBe('Description libre sans JSON');
    expect(result.extractedText).toBe('');
    expect(result.structuredData).toBeNull();
  });

  it('accepts JSON wrapped in markdown fences', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '```json\n{"summary":"Tableau visible","extractedText":"Client A 1200","structuredData":{"topClient":"A"}}\n```',
              },
            },
          ],
        }),
      })),
    );

    const result = await provider.analyze(
      {
        providerRowId: 'p1',
        provider: 'openai',
        kind: 'vision',
        model: 'gpt-4.1-mini',
        capabilities: { vision: true },
        settings: {},
      },
      { prompt: 'Analyse', images: [{ mimeType: 'image/png', buffer: PNG_1X1 }] },
    );

    expect(result.summary).toBe('Tableau visible');
    expect(result.extractedText).toBe('Client A 1200');
    expect(result.structuredData).toEqual({ topClient: 'A' });
  });
});
