import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryEmbeddingRepository } from './memory-embedding.repository.js';
import { MemoryService } from './memory.service.js';
import type { RetrievedMemory } from './memory.types.js';

interface RetrieveParams {
  userId: string;
  scope: string;
  space: string;
  queryText: string;
  limit?: number;
}

interface RetrieveOutcome {
  mode: 'semantic' | 'text' | 'none';
  memories: RetrievedMemory[];
  durationMs: number;
  embeddingProvider?: string;
  embeddingModel?: string | null;
  embeddingError?: string;
}

const SIMILARITY_WEIGHT = 0.5;
const IMPORTANCE_WEIGHT = 0.2;
const CONFIDENCE_WEIGHT = 0.15;
const RECENCY_WEIGHT = 0.1;
const FREQUENCY_WEIGHT = 0.05;
const RECENCY_HALF_LIFE_DAYS = 30;
const FREQUENCY_SATURATION = 10;

@Injectable()
export class MemoryRetrievalService {
  private readonly logger = new Logger(MemoryRetrievalService.name);
  private readonly defaultLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingRepository: MemoryEmbeddingRepository,
    private readonly memoryService: MemoryService,
    configService: ConfigService,
  ) {
    this.defaultLimit = configService.get<number>('app.memory.retrievalLimit') ?? 8;
  }

  async retrieve(params: RetrieveParams): Promise<RetrieveOutcome> {
    const start = Date.now();
    const limit = params.limit ?? this.defaultLimit;

    const embeddingOutcome = await this.embeddingService.embed(params.queryText);

    if (embeddingOutcome.enabled && embeddingOutcome.embedding && embeddingOutcome.dimensions) {
      const candidates = await this.embeddingRepository.searchSimilar({
        userId: params.userId,
        scope: params.scope,
        space: params.space,
        queryEmbedding: embeddingOutcome.embedding,
        dimensions: embeddingOutcome.dimensions,
        limit,
      });

      if (candidates.length > 0) {
        const scored = candidates
          .map((c) => ({
            id: c.id,
            content: c.content,
            kind: c.kind,
            importance: c.importance,
            confidence: c.confidence,
            score: this.score({
              similarity: c.similarity,
              importance: c.importance,
              confidence: c.confidence,
              lastAccessedAt: c.lastAccessedAt ?? c.createdAt,
              accessCount: c.accessCount,
            }),
            mode: 'semantic' as const,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        await this.memoryService.recordAccess(scored.map((m) => m.id));

        const durationMs = Date.now() - start;
        this.logger.debug(
          `Semantic retrieval: ${scored.length} memories in ${durationMs}ms (model=${embeddingOutcome.model})`,
        );
        return {
          mode: 'semantic',
          memories: scored,
          durationMs,
          embeddingProvider: 'openai-compatible',
          embeddingModel: embeddingOutcome.model,
        };
      }
      // Embedding worked but nothing embedded yet for this scope/space — fall
      // through to the text path rather than returning nothing.
    }

    return this.retrieveByText(params, limit, start, embeddingOutcome.error);
  }

  private async retrieveByText(
    params: RetrieveParams,
    limit: number,
    start: number,
    embeddingError?: string,
  ): Promise<RetrieveOutcome> {
    const tokens = tokenize(params.queryText).slice(0, 8);

    const rows =
      tokens.length === 0
        ? []
        : await this.prisma.memory.findMany({
            where: {
              userId: params.userId,
              scope: params.scope,
              space: params.space,
              status: 'active',
              OR: tokens.map((token) => ({ content: { contains: token, mode: 'insensitive' as const } })),
            },
            take: limit * 3, // over-fetch, then re-rank below
          });

    const scored = rows
      .map((row) => {
        const overlap = tokenOverlapRatio(tokens, row.content);
        return {
          id: row.id,
          content: row.content,
          kind: row.kind,
          importance: row.importance,
          confidence: row.confidence,
          score: this.score({
            similarity: overlap,
            importance: row.importance,
            confidence: row.confidence,
            lastAccessedAt: row.lastAccessedAt ?? row.createdAt,
            accessCount: row.accessCount,
          }),
          mode: 'text' as const,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    await this.memoryService.recordAccess(scored.map((m) => m.id));

    const durationMs = Date.now() - start;
    this.logger.debug(`Text-fallback retrieval: ${scored.length} memories in ${durationMs}ms`);

    return {
      mode: scored.length > 0 ? 'text' : 'none',
      memories: scored,
      durationMs,
      embeddingError,
    };
  }

  private score(params: {
    similarity: number;
    importance: number;
    confidence: number;
    lastAccessedAt: Date;
    accessCount: number;
  }): number {
    const ageDays = (Date.now() - params.lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
    const frequency = Math.min(params.accessCount / FREQUENCY_SATURATION, 1);

    return (
      SIMILARITY_WEIGHT * clamp01(params.similarity) +
      IMPORTANCE_WEIGHT * clamp01(params.importance) +
      CONFIDENCE_WEIGHT * clamp01(params.confidence) +
      RECENCY_WEIGHT * recency +
      FREQUENCY_WEIGHT * frequency
    );
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function tokenOverlapRatio(queryTokens: string[], content: string): number {
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  const matches = queryTokens.filter((token) => contentTokens.has(token)).length;
  return matches / queryTokens.length;
}
