import { BadRequestException } from '@nestjs/common';

export interface ValidatedVisionImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: '.png' | '.jpg' | '.webp';
  width: number;
  height: number;
}

export function validateVisionImage(buffer: Buffer): ValidatedVisionImage {
  const png = parsePng(buffer);
  if (png) return png;

  const jpeg = parseJpeg(buffer);
  if (jpeg) return jpeg;

  const webp = parseWebp(buffer);
  if (webp) return webp;

  throw new BadRequestException('Unsupported image type. Allowed formats: PNG, JPEG, WEBP.');
}

function parsePng(buffer: Buffer): ValidatedVisionImage | null {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;

  return {
    mimeType: 'image/png',
    extension: '.png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseJpeg(buffer: Buffer): ValidatedVisionImage | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;

    if (isStartOfFrame(marker)) {
      return {
        mimeType: 'image/jpeg',
        extension: '.jpg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function parseWebp(buffer: Buffer): ValidatedVisionImage | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { mimeType: 'image/webp', extension: '.webp', width, height };
  }

  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { mimeType: 'image/webp', extension: '.webp', width, height };
  }

  if (chunkType === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { mimeType: 'image/webp', extension: '.webp', width, height };
  }

  return null;
}
