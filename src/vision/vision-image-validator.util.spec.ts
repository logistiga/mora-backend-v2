import { describe, expect, it } from 'vitest';
import { validateVisionImage } from './vision-image-validator.util.js';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

describe('validateVisionImage', () => {
  it('accepts PNG and reads dimensions', () => {
    expect(validateVisionImage(PNG_1X1)).toEqual({
      mimeType: 'image/png',
      extension: '.png',
      width: 1,
      height: 1,
    });
  });

  it('rejects unsupported content even if it could come from an uploaded file', () => {
    expect(() => validateVisionImage(Buffer.from('not-an-image'))).toThrow(/Unsupported image type/i);
  });
});
