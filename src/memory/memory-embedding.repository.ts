import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface SemanticCandidate {
  id: string;
  content: string;
  kind: string;
  importance: number;
  confidence: number;
  accessCount: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
  similarity: number; // 0..1, higher = more similar (1 - cosine distance)
}

/**
 * The ONLY place in the codebase that touches `memories.embedding`. Prisma
 * has no native `vector` scalar (the column is `Unsupported("vector")` in
 * schema.prisma), so every read/write here goes through Prisma's tagged-
 * template `$queryRaw`/`$executeRaw`, which binds every interpolated value
 * (including the vector literal string) as a real query parameter — never
 * string-concatenated into the SQL text. The `::vector`/`::uuid` casts are
 * fixed SQL syntax, not user input.
 */
@Injectable()
export class MemoryEmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Serializes a numeric embedding into pgvector's text input format, e.g. "[0.1,-0.2,0.3]". */
  private toVectorLiteral(embedding: number[]): string {
    for (const value of embedding) {
      if (!Number.isFinite(value)) {
        throw new Error('Embedding contains a non-finite value; refusing to store it');
      }
    }
    return `[${embedding.join(',')}]`;
  }

  async setEmbedding(params: {
    memoryId: string;
    userId: string;
    embedding: number[];
    model: string;
    dimensions: number;
  }): Promise<void> {
    const vectorLiteral = this.toVectorLiteral(params.embedding);
    await this.prisma.$executeRaw`
      UPDATE memories
      SET embedding = ${vectorLiteral}::vector,
          embedding_model = ${params.model},
          embedding_dimensions = ${params.dimensions},
          updated_at = now()
      WHERE id = ${params.memoryId}::uuid AND user_id = ${params.userId}::uuid
    `;
  }

  /**
   * Exact (brute-force) cosine-similarity search, filtered strictly by
   * userId/scope/space (the isolation boundary) and by embeddingDimensions
   * (rows embedded with a different-sized vector are excluded rather than
   * causing a pgvector dimension-mismatch error — see schema.prisma for why
   * no ANN index exists yet).
   */
  async searchSimilar(params: {
    userId: string;
    scope: string;
    space: string;
    queryEmbedding: number[];
    dimensions: number;
    limit: number;
  }): Promise<SemanticCandidate[]> {
    const vectorLiteral = this.toVectorLiteral(params.queryEmbedding);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        kind: string;
        importance: number;
        confidence: number;
        access_count: number;
        last_accessed_at: Date | null;
        created_at: Date;
        similarity: number;
      }>
    >`
      SELECT id, content, kind, importance, confidence,
             access_count, last_accessed_at, created_at,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM memories
      WHERE user_id = ${params.userId}::uuid
        AND scope = ${params.scope}
        AND space = ${params.space}
        AND status = 'active'
        AND embedding IS NOT NULL
        AND embedding_dimensions = ${params.dimensions}
      ORDER BY embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${params.limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      kind: row.kind,
      importance: row.importance,
      confidence: row.confidence,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      similarity: row.similarity,
    }));
  }
}
