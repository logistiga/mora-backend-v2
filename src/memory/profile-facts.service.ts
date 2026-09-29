import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import type { ProfileFact, Prisma } from '../generated/prisma/client.js';

export interface ListProfileFactsQuery {
  scope?: string;
  space?: string;
  status?: string;
}

const RELEVANT_FACTS_LIMIT = 10;

/**
 * The reserved scope/space pair for the "Essential User Profile" (learning-
 * core phase): durable preferences that apply across virtually every
 * response — language behaviour, form of address, greeting/response style —
 * as opposed to a normal ProfileFact/Memory, which is scoped to exactly one
 * (userId, scope, space) triple ('personal' or a professional space) and
 * never crosses into the other. Reusing the existing ProfileFact table
 * (rather than a new one) with this sentinel value keeps this small, bounded
 * and query-compatible with the table's existing
 * `@@index([userId, scope, space, status])` — no migration needed.
 */
export const ESSENTIAL_SCOPE = 'essential';
export const ESSENTIAL_SPACE = 'essential';

export interface UpsertEssentialFactInput {
  key: string;
  value: string;
  confidence: number;
  source: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ProfileFactsService {
  private readonly essentialLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.essentialLimit = configService.get<number>('app.memory.essentialProfileLimit') ?? 12;
  }

  async list(userId: string, query: ListProfileFactsQuery): Promise<ProfileFact[]> {
    return this.prisma.profileFact.findMany({
      where: {
        userId,
        scope: query.scope,
        space: query.space,
        status: query.status ?? 'active',
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Used by ContextBuilderService — small, strictly scoped, active facts only. */
  async getRelevant(userId: string, scope: string, space: string): Promise<ProfileFact[]> {
    return this.prisma.profileFact.findMany({
      where: { userId, scope, space, status: 'active' },
      orderBy: { confidence: 'desc' },
      take: RELEVANT_FACTS_LIMIT,
    });
  }

  /**
   * The Essential User Profile: small, bounded, fast (single indexed query,
   * no embeddings, no LLM call), and — unlike `getRelevant` — NOT scoped to
   * a single (scope, space): these facts are meant to apply everywhere,
   * including the tool-less "direct" route. Callers must never widen this
   * into "load everything the user ever said" — the bound is enforced here,
   * not left to the caller.
   */
  async getEssential(userId: string): Promise<ProfileFact[]> {
    return this.prisma.profileFact.findMany({
      where: { userId, scope: ESSENTIAL_SCOPE, space: ESSENTIAL_SPACE, status: 'active' },
      orderBy: { confidence: 'desc' },
      take: this.essentialLimit,
    });
  }

  /**
   * Writes (or supersedes) one Essential Profile fact. Matched by `key`
   * (exact, case-insensitive) rather than the Memory table's content-
   * similarity heuristic: essential facts are structured key/value
   * preferences (e.g. `language_behavior`), so an exact-key match is both
   * simpler and more reliable than fuzzy text overlap, and mirrors how a
   * user would naturally correct one specific preference ("finalement,
   * ne fais plus ça") without touching the others.
   */
  async upsertEssential(userId: string, input: UpsertEssentialFactInput): Promise<ProfileFact> {
    const existing = await this.prisma.profileFact.findFirst({
      where: {
        userId,
        scope: ESSENTIAL_SCOPE,
        space: ESSENTIAL_SPACE,
        status: 'active',
        key: { equals: input.key, mode: 'insensitive' },
      },
    });

    if (!existing) {
      return this.prisma.profileFact.create({
        data: {
          userId,
          scope: ESSENTIAL_SCOPE,
          space: ESSENTIAL_SPACE,
          key: input.key,
          value: input.value,
          confidence: input.confidence,
          source: input.source,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    // Identical value re-taught (e.g. the user repeats the same instruction):
    // nudge confidence up rather than spawning a pointless supersession chain.
    if (existing.value.trim().toLowerCase() === input.value.trim().toLowerCase()) {
      return this.prisma.profileFact.update({
        where: { id: existing.id },
        data: { confidence: Math.max(existing.confidence, input.confidence) },
      });
    }

    const replacement = await this.prisma.profileFact.create({
      data: {
        userId,
        scope: ESSENTIAL_SCOPE,
        space: ESSENTIAL_SPACE,
        key: input.key,
        value: input.value,
        confidence: input.confidence,
        source: input.source,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.prisma.profileFact.update({
      where: { id: existing.id },
      data: { status: 'superseded', supersededById: replacement.id },
    });

    return replacement;
  }

  /** Explicit correction/removal path ("finalement, ne fais plus ça") — archives by key, never deletes. */
  async archiveEssentialByKey(userId: string, key: string): Promise<ProfileFact | null> {
    const existing = await this.prisma.profileFact.findFirst({
      where: { userId, scope: ESSENTIAL_SCOPE, space: ESSENTIAL_SPACE, status: 'active', key: { equals: key, mode: 'insensitive' } },
    });
    if (!existing) return null;
    return this.prisma.profileFact.update({ where: { id: existing.id }, data: { status: 'archived' } });
  }
}
