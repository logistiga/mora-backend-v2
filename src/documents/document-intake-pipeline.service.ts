import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { EntitiesService } from '../memory/entities.service.js';
import { DocumentChunkEmbeddingRepository } from './document-chunk-embedding.repository.js';
import { DocumentClassificationService } from './document-classification.service.js';
import { DocumentChunkerService } from './extraction/document-chunker.service.js';
import { DocumentExtractionService } from './extraction/document-extraction.service.js';
import type { DocumentStorageInterface } from './storage/document-storage.interface.js';
import { DOCUMENT_STORAGE } from './storage/document-storage.token.js';
import { normalizeTag } from './tag-normalization.util.js';

/**
 * Runs the full intake pipeline for one document (AGENTS Phase E §5):
 * extract → classify → tags → entities → summarize → tables → chunk →
 * embeddings → ready. Every stage is wrapped so a failure in one stage
 * (e.g. classification, if the LLM is unavailable) degrades that stage
 * gracefully rather than failing the whole document — the only stage that
 * can genuinely fail the document is extraction itself (no text = nothing
 * to index). One document's failure never touches another (each runs as
 * its own BullMQ job, see DocumentProcessingProcessor).
 */
@Injectable()
export class DocumentIntakePipelineService {
  private readonly logger = new Logger(DocumentIntakePipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorageInterface,
    private readonly extraction: DocumentExtractionService,
    private readonly classification: DocumentClassificationService,
    private readonly chunker: DocumentChunkerService,
    private readonly embeddingService: EmbeddingService,
    private readonly chunkEmbeddings: DocumentChunkEmbeddingRepository,
    private readonly entitiesService: EntitiesService,
    private readonly auditService: AuditService,
  ) {}

  async process(documentId: string, userId: string): Promise<void> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.userId !== userId) {
      this.logger.warn(`Processing job for missing/foreign document ${documentId}, skipping`);
      return;
    }

    await this.prisma.document.update({ where: { id: documentId }, data: { status: 'processing' } });
    await this.auditService.log({
      userId,
      action: 'document_processing_started',
      scope: document.scope,
      space: document.space,
      metadata: { documentId },
    });

    try {
      const buffer = await this.storage.read(document.storageKey);
      const extracted = await this.extraction.extract(buffer, document.extension);

      if (extracted.needsOcrFallback) {
        // No exploitable text and no OCR in Phase E (AGENTS §4) — mark for
        // human review rather than silently indexing nothing.
        await this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'needs_review', needsReview: true, errorMessage: 'No extractable text (OCR not available in Phase E)' },
        });
        return;
      }

      // Classification is best-effort: no LLM configured, or a parse
      // failure, degrades to "no suggestion" rather than failing the document.
      const classificationResult = await this.classification
        .classify(extracted.text, { userId, scope: document.scope, space: document.space, filename: document.originalFilename })
        .catch((error: unknown) => {
          this.logger.warn(`Classification failed for document ${documentId}: ${String(error)}`);
          return null;
        });

      const needsReview = classificationResult ? this.classification.needsReview(classificationResult) : true;

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          documentType: classificationResult?.documentType,
          title: classificationResult?.title ?? document.originalFilename,
          language: classificationResult?.language,
          classificationConfidence: classificationResult?.confidence,
          needsReview,
          summary: extracted.text.slice(0, 600) || null, // short extractive fallback; a real abstractive summary needs the LLM, done below
        },
      });

      if (classificationResult) {
        await this.applyTags(documentId, classificationResult.tags);
        await this.applyEntities(documentId, userId, document.scope, document.space, classificationResult.entityNames);
      }

      await this.persistTables(documentId, extracted.tables);
      await this.chunkAndEmbed(documentId, userId, document.scope, document.space, extracted.text);

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: needsReview ? 'needs_review' : 'ready', processedAt: new Date() },
      });

      await this.auditService.log({
        userId,
        action: 'document_processing_completed',
        scope: document.scope,
        space: document.space,
        metadata: { documentId, needsReview },
      });
    } catch (error) {
      this.logger.error(`Document processing failed for ${documentId}`, error instanceof Error ? error.stack : error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'failed', errorMessage: sanitizeError(error) },
      });
      await this.auditService.log({
        userId,
        action: 'document_processing_failed',
        scope: document.scope,
        space: document.space,
        metadata: { documentId, error: sanitizeError(error) },
      });
      throw error; // let BullMQ retry per its own backoff policy
    }
  }

  private async applyTags(documentId: string, rawTags: string[]): Promise<void> {
    for (const raw of rawTags) {
      const name = normalizeTag(raw);
      if (!name) continue;
      const tag = await this.prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
      await this.prisma.documentTag.upsert({
        where: { documentId_tagId: { documentId, tagId: tag.id } },
        create: { documentId, tagId: tag.id, source: 'ai', confidence: 0.7 },
        update: {},
      });
    }
  }

  private async applyEntities(
    documentId: string,
    userId: string,
    scope: string,
    space: string,
    entityNames: { name: string; type: string }[],
  ): Promise<void> {
    for (const { name, type } of entityNames) {
      const entity = await this.entitiesService.findOrCreate({ userId, scope, space, type, name: name.slice(0, 200) });
      await this.prisma.documentEntity.upsert({
        where: { documentId_entityId: { documentId, entityId: entity.id } },
        create: { documentId, entityId: entity.id, role: 'mentioned' },
        update: {},
      });
    }
  }

  private async persistTables(
    documentId: string,
    tables: { sheetName?: string; tableIndex: number; title?: string; columns: { name: string; type: string }[]; rows: Record<string, unknown>[] }[],
  ): Promise<void> {
    for (const table of tables) {
      const created = await this.prisma.documentTable.create({
        data: {
          documentId,
          sheetName: table.sheetName,
          tableIndex: table.tableIndex,
          title: table.title,
          columns: table.columns as unknown as Prisma.InputJsonValue,
          rowCount: table.rows.length,
          columnCount: table.columns.length,
        },
      });

      if (table.rows.length > 0) {
        // batched insert, bounded per-call size — a real rows table stays
        // queryable/paginable even for a large spreadsheet (AGENTS §15).
        const BATCH = 500;
        for (let i = 0; i < table.rows.length; i += BATCH) {
          const slice = table.rows.slice(i, i + BATCH);
          await this.prisma.documentTableRow.createMany({
            data: slice.map((row, idx) => ({
              tableId: created.id,
              rowIndex: i + idx,
              data: row as unknown as Prisma.InputJsonValue,
            })),
          });
        }
      }
    }
  }

  private async chunkAndEmbed(documentId: string, userId: string, scope: string, space: string, text: string): Promise<void> {
    if (!text.trim()) return;
    const chunks = this.chunker.chunk(text);

    for (const chunk of chunks) {
      const created = await this.prisma.documentChunk.create({
        data: {
          documentId,
          chunkIndex: chunk.chunkIndex,
          section: chunk.section,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        },
      });

      const outcome = await this.embeddingService.embed(chunk.content, { userId, scope, space });
      if (outcome.enabled && outcome.embedding && outcome.dimensions && outcome.model) {
        await this.chunkEmbeddings.setEmbedding({
          chunkId: created.id,
          embedding: outcome.embedding,
          model: outcome.model,
          dimensions: outcome.dimensions,
        });
      }
      // No embedding provider configured → chunk stays text-searchable only
      // (full-text fallback in DocumentRetrievalService), same graceful
      // degradation as Phase C memory.
    }
  }
}

/** Never leaks a raw stack/internal path into a DB column a user might read back. */
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
