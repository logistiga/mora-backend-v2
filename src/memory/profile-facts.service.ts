import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { ProfileFact } from '../generated/prisma/client.js';

export interface ListProfileFactsQuery {
  scope?: string;
  space?: string;
  status?: string;
}

const RELEVANT_FACTS_LIMIT = 10;

@Injectable()
export class ProfileFactsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
