import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VisionAsset, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { DocumentStorageInterface } from '../documents/storage/document-storage.interface.js';
import { DOCUMENT_STORAGE } from '../documents/storage/document-storage.token.js';
import { sha256 } from '../documents/extraction/checksum.util.js';
import { validateVisionImage } from './vision-image-validator.util.js';
import type { VisionSourceType } from './vision.types.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 4096;

@Injectable()
export class VisionAssetService {
  private readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorageInterface,
    configService: ConfigService,
  ) {
    this.maxUploadBytes = Math.min(configService.get<number>('app.documents.maxUploadBytes') ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  }

  getLimits() {
    return { maxUploadBytes: this.maxUploadBytes, maxFiles: 4 };
  }

  async createOrReuse(input: {
    userId: string;
    conversationId: string;
    scope: string;
    space: string;
    sourceType: VisionSourceType;
    originalFilename: string;
    buffer: Buffer;
  }): Promise<{ asset: VisionAsset; created: boolean }> {
    if (input.buffer.length === 0) throw new BadRequestException('Empty image');
    if (input.buffer.length > this.maxUploadBytes) throw new BadRequestException(`Image exceeds ${this.maxUploadBytes} bytes`);

    const validated = validateVisionImage(input.buffer);
    if (validated.width <= 0 || validated.height <= 0 || validated.width > MAX_DIMENSION || validated.height > MAX_DIMENSION) {
      throw new BadRequestException(`Unsupported image dimensions (${validated.width}x${validated.height})`);
    }

    const checksum = sha256(input.buffer);
    const existing = await this.prisma.visionAsset.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        scope: input.scope,
        space: input.space,
        checksum,
      },
    });
    if (existing) return { asset: existing, created: false };

    const safeName = normalizeFilename(input.originalFilename, validated.extension);
    const { storageProvider, storageKey } = await this.storage.save(input.userId, input.buffer, safeName);
    const asset = await this.prisma.visionAsset.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        scope: input.scope,
        space: input.space,
        sourceType: input.sourceType,
        originalFilename: safeName,
        mimeType: validated.mimeType,
        extension: validated.extension,
        sizeBytes: input.buffer.length,
        width: validated.width,
        height: validated.height,
        storageProvider,
        storageKey,
        checksum,
        metadata: { sourceType: input.sourceType } as Prisma.InputJsonValue,
      },
    });
    return { asset, created: true };
  }

  async readBuffer(asset: VisionAsset): Promise<Buffer> {
    return this.storage.read(asset.storageKey);
  }

  async markAnalyzed(
    assetId: string,
    result: { summary: string; extractedText: string; structuredData: Record<string, unknown> | null; provider: string; model: string },
  ): Promise<VisionAsset> {
    return this.prisma.visionAsset.update({
      where: { id: assetId },
      data: {
        status: 'analyzed',
        summary: result.summary,
        extractedText: result.extractedText,
        analysis: { provider: result.provider, model: result.model, structuredData: result.structuredData } as Prisma.InputJsonValue,
        analyzedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  async markFailed(assetId: string, errorMessage: string): Promise<void> {
    await this.prisma.visionAsset.update({
      where: { id: assetId },
      data: { status: 'failed', errorMessage: errorMessage.slice(0, 300) },
    });
  }

  async attachToMessage(userId: string, assetIds: string[], messageId: string): Promise<void> {
    if (assetIds.length === 0) return;
    await this.prisma.visionAsset.updateMany({
      where: { userId, id: { in: assetIds } },
      data: { messageId },
    });
  }

  async getOwned(userId: string, id: string): Promise<VisionAsset> {
    const asset = await this.prisma.visionAsset.findUnique({ where: { id } });
    if (!asset || asset.userId !== userId) throw new NotFoundException('Vision asset not found');
    return asset;
  }
}

function normalizeFilename(originalFilename: string, extension: '.png' | '.jpg' | '.webp'): string {
  const base =
    Array.from(originalFilename, (char) => (isUnsafeFilenameChar(char) ? '_' : char)).join('').trim() || 'image';
  const withoutExt = base.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) || 'image';
  return `${withoutExt}${extension}`;
}

function isUnsafeFilenameChar(char: string): boolean {
  return /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32;
}
