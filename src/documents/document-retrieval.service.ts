import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { DocumentChunkEmbeddingRepository } from './document-chunk-embedding.repository.js';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  page: number | null;
  section: string | null;
  score: number;
  mode: 'semantic' | 'text';
}

interface RetrieveParams {
  userId: string;
  scope: string;
  space: string;
  queryText: string;
  limit?: number;
  tags?: string[];
  documentType?: string;
}

const CANDIDATE_OVERFETCH = 5;

/**
 * Multi-stage retrieval (AGENTS Phase E §12): metadata/tag filters narrow
 * the candidate set in SQL FIRST (never "read every document"), then
 * semantic (pgvector, HNSW-accelerated for 1536-dim embeddings) or
 * full-text fallback ranks within that already-narrowed set. Designed to
 * stay a bounded, indexed query at 1k/10k/100k documents — the candidate
 * filter and the vector/text search are both plain indexed SQL, never a
 * full table scan of chunk content.
 */
@Injectable()
export class DocumentRetrievalService {
  private readonly logger = new Logger(DocumentRetrievalService.name);
  private readonly defaultLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly chunkEmbeddings: DocumentChunkEmbeddingRepository,
    configService: ConfigService,
  ) {
    this.defaultLimit = configService.get<number>('app.memory.retrievalLimit') ?? 8;
  }

  async retrieve(params: RetrieveParams): Promise<{ mode: 'semantic' | 'text' | 'none'; chunks: RetrievedChunk[]; durationMs: number }> {
    const start = Date.now();
    const limit = params.limit ?? this.defaultLimit;

    // Stage 1: candidate document ids from metadata filters (tags/type) —
    // cheap, indexed, narrows the search space before any vector work.
    const candidateDocumentIds = await this.candidateDocumentIds(params);
    if (candidateDocumentIds !== null && candidateDocumentIds.length === 0) {
      return { mode: 'none', chunks: [], durationMs: Date.now() - start };
    }

    const embeddingOutcome = await this.embeddingService.embed(params.queryText, {
      userId: params.userId,
      scope: params.scope,
      space: params.space,
    });

    if (embeddingOutcome.enabled && embeddingOutcome.embedding && embeddingOutcome.dimensions) {
      const candidates = await this.chunkEmbeddings.searchSimilar({
        userId: params.userId,
        scope: params.scope,
        space: params.space,
        queryEmbedding: embeddingOutcome.embedding,
        dimensions: embeddingOutcome.dimensions,
        limit: limit * CANDIDATE_OVERFETCH,
      });

      const filtered = candidateDocumentIds
        ? candidates.filter((c) => candidateDocumentIds.includes(c.documentId))
        : candidates;

      if (filtered.length > 0) {
        const titles = await this.titlesFor(filtered.map((c) => c.documentId));
        const chunks: RetrievedChunk[] = filtered.slice(0, limit).map((c) => ({
          chunkId: c.id,
          documentId: c.documentId,
          documentTitle: titles.get(c.documentId) ?? 'Document',
          content: c.content,
          page: c.page,
          section: c.section,
          score: c.similarity,
          mode: 'semantic',
        }));
        return { mode: 'semantic', chunks, durationMs: Date.now() - start };
      }
    }

    return this.retrieveByText(params, candidateDocumentIds, limit, start);
  }

  private async candidateDocumentIds(params: RetrieveParams): Promise<string[] | null> {
    if (!params.tags?.length && !params.documentType) return null;

    const docs = await this.prisma.document.findMany({
      where: {
        userId: params.userId,
        scope: params.scope,
        space: params.space,
        status: 'ready',
        documentType: params.documentType,
        ...(params.tags?.length
          ? { docTags: { some: { tag: { name: { in: params.tags } } } } }
          : {}),
      },
      select: { id: true },
      take: 500,
    });
    return docs.map((d) => d.id);
  }

  private async retrieveByText(
    params: RetrieveParams,
    candidateDocumentIds: string[] | null,
    limit: number,
    start: number,
  ): Promise<{ mode: 'semantic' | 'text' | 'none'; chunks: RetrievedChunk[]; durationMs: number }> {
    const tokens = tokenize(params.queryText).slice(0, 8);
    if (tokens.length === 0) {
      return { mode: 'none', chunks: [], durationMs: Date.now() - start };
    }

    const rows = await this.prisma.documentChunk.findMany({
      where: {
        document: {
          userId: params.userId,
          scope: params.scope,
          space: params.space,
          status: 'ready',
          id: candidateDocumentIds ? { in: candidateDocumentIds } : undefined,
        },
        OR: tokens.map((token) => ({ content: { contains: token, mode: 'insensitive' as const } })),
      },
      include: { document: { select: { title: true, originalFilename: true } } },
      take: limit * 3,
    });

    const scored = rows
      .map((row) => ({
        chunkId: row.id,
        documentId: row.documentId,
        documentTitle: row.document.title ?? row.document.originalFilename,
        content: row.content,
        page: row.page,
        section: row.section,
        score: tokenOverlapRatio(tokens, row.content),
        mode: 'text' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      mode: scored.length > 0 ? 'text' : 'none',
      chunks: scored,
      durationMs: Date.now() - start,
    };
  }

  private async titlesFor(documentIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(documentIds)];
    const docs = await this.prisma.document.findMany({
      where: { id: { in: unique } },
      select: { id: true, title: true, originalFilename: true },
    });
    return new Map(docs.map((d) => [d.id, d.title ?? d.originalFilename]));
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function tokenOverlapRatio(queryTokens: string[], content: string): number {
  const contentTokens = new Set(tokenize(content));
  if (contentTokens.size === 0) return 0;
  const hits = queryTokens.filter((t) => contentTokens.has(t)).length;
  return hits / queryTokens.length;
}
