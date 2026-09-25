import { describe, expect, it } from 'vitest';
import { buildVisionContextNote } from './vision-context.util.js';

describe('buildVisionContextNote', () => {
  it('renders a bounded multimodal note as data, not instructions', () => {
    const note = buildVisionContextNote([
      {
        sourceType: 'screenshot',
        originalFilename: 'capture.png',
        summary: 'Un tableau de bord montre trois cartes KPI.',
        extractedText: 'Ventes: 120\nMarge: 18%',
        structuredData: { sales: 120, margin: '18%' },
        width: 800,
        height: 600,
      },
    ]);

    expect(note).toContain('Contexte visuel attache a cette demande');
    expect(note).toContain('capture.png');
    expect(note).toContain('DONNEE');
    expect(note).toContain('Ventes: 120');
  });
});
