import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Memory, Prisma } from '../generated/prisma/client.js';
import type { CreateMemoryDto } from './dto/create-memory.dto.js';
import type { ListMemoriesQueryDto } from './dto/list-memories.dto.js';
import type { UpdateMemoryDto } from './dto/update-memory.dto.js';
import { MemoryQueueService } from './queue/memory-queue.service.js';

const LIST_LIMIT = 100;

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryQueue: MemoryQueueService,
  ) {}

  async create(
    userId: string,
    dto: CreateMemoryDto,
    source: 'manual' | 'extraction' = 'manual',
    sourceId?: string,
  ): Promise<Memory> {
    const memory = await this.prisma.memory.create({
      data: {
        userId,
        scope: dto.scope,
        space: dto.space,
        kind: dto.kind,
        content: dto.content,
        importance: dto.importance ?? 0.5,
        confidence: dto.confidence ?? 0.5,
        source,
        sourceId,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Fire-and-forget: the caller never waits on embedding generation.
    await this.memoryQueue.enqueueEmbedding({ memoryId: memory.id, userId });

    return memory;
  }

  async getById(userId: string, id: string): Promise<Memory> {
    const memory = await this.prisma.memory.findUnique({ where: { id } });
    if (!memory) {
      throw new NotFoundException('Memory not found');
    }
    if (memory.userId !== userId) {
      throw new ForbiddenException('This memory does not belong to you');
    }
    return memory;
  }

  async list(userId: string, query: ListMemoriesQueryDto): Promise<Memory[]> {
    const where: Prisma.MemoryWhereInput = { userId };
    if (query.scope) where.scope = query.scope;
    if (query.space) where.space = query.space;
    if (query.kind) where.kind = query.kind;
    where.status = query.status ?? 'active';
    if (query.search) {
      where.content = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.memory.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
    });
  }

  async update(userId: string, id: string, dto: UpdateMemoryDto): Promise<Memory> {
    const existing = await this.getById(userId, id);
    const contentChanged = dto.content !== undefined && dto.content !== existing.content;

    const updated = await this.prisma.memory.update({
      where: { id },
      data: {
        content: dto.content,
        importance: dto.importance,
        confidence: dto.confidence,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    // Content changed → the stored embedding (if any) is now stale.
    if (contentChanged) {
      await this.memoryQueue.enqueueEmbedding({ memoryId: id, userId });
    }

    return updated;
  }

  async archive(userId: string, id: string): Promise<Memory> {
    await this.getById(userId, id);
    return this.prisma.memory.update({ where: { id }, data: { status: 'archived' } });
  }

  /**
   * Replaces `oldId` with a brand-new memory: the old row is marked
   * `superseded` (never deleted — history is kept) and points at the new
   * one via `supersededById`; the new row starts `active`.
   */
  async supersede(
    userId: string,
    oldId: string,
    dto: CreateMemoryDto,
    source: 'manual' | 'extraction' = 'manual',
    sourceId?: string,
  ): Promise<{ old: Memory; replacement: Memory }> {
    const old = await this.getById(userId, oldId);

    const replacement = await this.prisma.memory.create({
      data: {
        userId,
        scope: dto.scope,
        space: dto.space,
        kind: dto.kind,
        content: dto.content,
        importance: dto.importance ?? old.importance,
        confidence: dto.confidence ?? old.confidence,
        source,
        sourceId,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    const updatedOld = await this.prisma.memory.update({
      where: { id: oldId },
      data: { status: 'superseded', supersededById: replacement.id },
    });

    await this.memoryQueue.enqueueEmbedding({ memoryId: replacement.id, userId });

    return { old: updatedOld, replacement };
  }

  /** Finds the best active candidate to supersede (same user/scope/space/kind, similar wording). */
  async findSupersessionCandidate(
    userId: string,
    scope: string,
    space: string,
    kind: string,
    content: string,
  ): Promise<Memory | null> {
    const candidates = await this.prisma.memory.findMany({
      where: { userId, scope, space, kind, status: 'active' },
      take: 20,
    });

    const contentTokens = tokenize(content);
    let best: { memory: Memory; overlap: number } | null = null;
    for (const candidate of candidates) {
      const overlap = jaccardSimilarity(contentTokens, tokenize(candidate.content));
      if (overlap >= 0.6 && (!best || overlap > best.overlap)) {
        best = { memory: candidate, overlap };
      }
    }
    return best?.memory ?? null;
  }

  /** Marks retrieved memories as accessed (used by MemoryRetrievalService). */
  async recordAccess(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.memory.updateMany({
      where: { id: { in: ids } },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
