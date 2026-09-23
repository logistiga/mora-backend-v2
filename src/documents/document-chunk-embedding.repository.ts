import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface ChunkSemanticCandidate {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  page: number | null;
  section: string | null;
  similarity: number;
}

const HNSW_ELIGIBLE_DIMENSIONS = 1536;

/**
 * The only place touching `document_chunks.embedding`/`embedding_vector_1536`
 * (same raw-SQL discipline as MemoryEmbeddingRepository — every interpolated
 * value is bound as a real query parameter, never string-concatenated).
 *
 * ANN strategy (AGENTS Phase E §13, see schema.prisma for the full
 * rationale): a 1536-dimension embedding (today's real provider) is written
 * to BOTH the flexible `embedding` column and the HNSW-indexed
 * `embedding_vector_1536` column, and search prefers the indexed column
 * whenever the query embedding is also 1536-dimensional. Any other
 * dimension only ever touches the flexible brute-force column — multi-
 * provider flexibility is never broken.
 */
@Injectable()
export class DocumentChunkEmbeddingRepository {
  private readonly logger = new Logger(DocumentChunkEmbeddingRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private toVectorLiteral(embedding: number[]): string {
    for (const value of embedding) {
      if (!Number.isFinite(value)) {
        throw new Error('Embedding contains a non-finite value; refusing to store it');
      }
    }
    return `[${embedding.join(',')}]`;
  }

  async setEmbedding(params: { chunkId: string; embedding: number[]; model: string; dimensions: number }): Promise<void> {
    const vectorLiteral = this.toVectorLiteral(params.embedding);

    if (params.dimensions === HNSW_ELIGIBLE_DIMENSIONS) {
      await this.prisma.$executeRaw`
        UPDATE document_chunks
        SET embedding = ${vectorLiteral}::vector,
            embedding_vector_1536 = ${vectorLiteral}::vector,
            embedding_model = ${params.model},
            embedding_dimensions = ${params.dimensions}
        WHERE id = ${params.chunkId}::uuid
      `;
    } else {
      await this.prisma.$executeRaw`
        UPDATE document_chunks
        SET embedding = ${vectorLiteral}::vector,
            embedding_model = ${params.model},
            embedding_dimensions = ${params.dimensions}
        WHERE id = ${params.chunkId}::uuid
      `;
    }
  }

  /**
   * Scoped strictly by (userId, scope, space) via a join to `documents` —
   * the same isolation boundary as every other retrieval in this codebase.
   * Uses the real HNSW index when the query embedding is 1536-dimensional
   * (an approximate search — pgvector's `<=>` operator against an
   * hnsw-indexed column), and the brute-force `embedding` column otherwise.
   */
  async searchSimilar(params: {
    userId: string;
    scope: string;
    space: string;
    queryEmbedding: number[];
    dimensions: number;
    limit: number;
  }): Promise<ChunkSemanticCandidate[]> {
    const vectorLiteral = this.toVectorLiteral(params.queryEmbedding);
    const useAnnIndex = params.dimensions === HNSW_ELIGIBLE_DIMENSIONS;

    const rows = useAnnIndex
      ? await this.prisma.$queryRaw<RawRow[]>`
          SELECT dc.id, dc.document_id, dc.content, dc.chunk_index, dc.page, dc.section,
                 1 - (dc.embedding_vector_1536 <=> ${vectorLiteral}::vector) AS similarity
          FROM document_chunks dc
          JOIN documents d ON d.id = dc.document_id
          WHERE d.user_id = ${params.userId}::uuid
            AND d.scope = ${params.scope}
            AND d.space = ${params.space}
            AND d.status = 'ready'
            AND dc.embedding_vector_1536 IS NOT NULL
          ORDER BY dc.embedding_vector_1536 <=> ${vectorLiteral}::vector ASC
          LIMIT ${params.limit}
        `
      : await this.prisma.$queryRaw<RawRow[]>`
          SELECT dc.id, dc.document_id, dc.content, dc.chunk_index, dc.page, dc.section,
                 1 - (dc.embedding <=> ${vectorLiteral}::vector) AS similarity
          FROM document_chunks dc
          JOIN documents d ON d.id = dc.document_id
          WHERE d.user_id = ${params.userId}::uuid
            AND d.scope = ${params.scope}
            AND d.space = ${params.space}
            AND d.status = 'ready'
            AND dc.embedding IS NOT NULL
            AND dc.embedding_dimensions = ${params.dimensions}
          ORDER BY dc.embedding <=> ${vectorLiteral}::vector ASC
          LIMIT ${params.limit}
        `;

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      page: row.page,
      section: row.section,
      similarity: row.similarity,
    }));
  }
}

interface RawRow {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  page: number | null;
  section: string | null;
  similarity: number;
}
