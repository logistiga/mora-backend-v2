import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { PrismaService } from '../database/prisma.service.js';
import type { Document, Prisma } from '../generated/prisma/client.js';
import type { ListDocumentsQueryDto } from './dto/list-documents.dto.js';
import type { UpdateDocumentDto } from './dto/update-document.dto.js';
import { DocumentExtractionService } from './extraction/document-extraction.service.js';
import { sha256 } from './extraction/checksum.util.js';
import { DocumentQueueService } from './queue/document-queue.service.js';
import type { DocumentStorageInterface } from './storage/document-storage.interface.js';
import { DOCUMENT_STORAGE } from './storage/document-storage.token.js';
import { normalizeTag } from './tag-normalization.util.js';

const LIST_LIMIT = 100;

export interface UploadDocumentInput {
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
  source?: string;
  sourceId?: string;
}

@Injectable()
export class DocumentService {
  private readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorageInterface,
    private readonly extraction: DocumentExtractionService,
    private readonly documentQueue: DocumentQueueService,
    configService: ConfigService,
  ) {
    this.maxUploadBytes = configService.get<number>('app.documents.maxUploadBytes') ?? 26214400;
  }

  async upload(input: UploadDocumentInput): Promise<Document> {
    if (input.buffer.length === 0) {
      throw new BadRequestException('Empty file');
    }
    if (input.buffer.length > this.maxUploadBytes) {
      throw new BadRequestException(`File exceeds the maximum allowed size (${this.maxUploadBytes} bytes)`);
    }

    const extension = path.extname(input.originalFilename).toLowerCase();
    if (!this.extraction.isSupported(extension)) {
      throw new BadRequestException(`Unsupported file type: ${extension || '(none)'}`);
    }

    const checksum = sha256(input.buffer);

    // Dedup: an identical file (same content) already uploaded by this same
    // user/scope/space is not re-stored — the existing row is returned as-is.
    const existing = await this.prisma.document.findFirst({
      where: { userId: input.userId, scope: input.scope, space: input.space, checksum },
    });
    if (existing) {
      return existing;
    }

    const { storageProvider, storageKey } = await this.storage.save(input.userId, input.buffer, input.originalFilename);

    const document = await this.prisma.document.create({
      data: {
        userId: input.userId,
        scope: input.scope,
        space: input.space,
        filename: path.basename(storageKey),
        originalFilename: input.originalFilename.slice(0, 255),
        mimeType: input.mimeType,
        extension,
        sizeBytes: input.buffer.length,
        source: input.source ?? 'upload',
        sourceId: input.sourceId,
        storageProvider,
        storageKey,
        status: 'queued',
        checksum,
      },
    });

    await this.documentQueue.enqueueProcessing({ documentId: document.id, userId: input.userId });
    return document;
  }

  async list(userId: string, query: ListDocumentsQueryDto): Promise<Document[]> {
    const where: Prisma.DocumentWhereInput = { userId };
    if (query.scope) where.scope = query.scope;
    if (query.space) where.space = query.space;
    if (query.status) where.status = query.status;
    if (query.documentType) where.documentType = query.documentType;
    if (query.source) where.source = query.source;
    if (query.needsReview !== undefined) where.needsReview = query.needsReview === 'true';
    if (query.tag) {
      const normalized = normalizeTag(query.tag);
      where.docTags = { some: { tag: { name: normalized } } };
    }

    return this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
  }

  async getById(userId: string, id: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document not found');
    if (document.userId !== userId) throw new ForbiddenException('This document does not belong to you');
    return document;
  }

  async getWithDetails(userId: string, id: string) {
    const document = await this.getById(userId, id);
    const [tags, entities, tables] = await Promise.all([
      this.prisma.documentTag.findMany({ where: { documentId: id }, include: { tag: true } }),
      this.prisma.documentEntity.findMany({ where: { documentId: id }, include: { entity: true } }),
      this.prisma.documentTable.findMany({ where: { documentId: id } }),
    ]);
    return { document, tags: tags.map((t) => t.tag.name), entities: entities.map((e) => e.entity), tables };
  }

  async update(userId: string, id: string, dto: UpdateDocumentDto): Promise<Document> {
    await this.getById(userId, id);

    if (dto.tags) {
      await this.setManualTags(id, dto.tags);
    }

    return this.prisma.document.update({
      where: { id },
      data: { title: dto.title },
    });
  }

  async archive(userId: string, id: string): Promise<Document> {
    await this.getById(userId, id);
    return this.prisma.document.update({ where: { id }, data: { status: 'archived' } });
  }

  async reprocess(userId: string, id: string): Promise<Document> {
    const document = await this.getById(userId, id);
    const updated = await this.prisma.document.update({
      where: { id },
      data: { status: 'queued', errorMessage: null, needsReview: false },
    });
    await this.documentQueue.enqueueProcessing({ documentId: document.id, userId });
    return updated;
  }

  private async setManualTags(documentId: string, rawTags: string[]): Promise<void> {
    for (const raw of rawTags) {
      const name = normalizeTag(raw);
      if (!name) continue;
      const tag = await this.prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
      await this.prisma.documentTag.upsert({
        where: { documentId_tagId: { documentId, tagId: tag.id } },
        create: { documentId, tagId: tag.id, source: 'manual' },
        update: {},
      });
    }
  }
}
