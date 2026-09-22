import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Entity } from '../generated/prisma/client.js';

export interface ListEntitiesQuery {
  scope?: string;
  space?: string;
  type?: string;
}

@Injectable()
export class EntitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListEntitiesQuery): Promise<Entity[]> {
    return this.prisma.entity.findMany({
      where: { userId, scope: query.scope, space: query.space, type: query.type },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Dedup-aware upsert used by extraction: same user+scope+space+type+name = same entity. */
  async findOrCreate(params: {
    userId: string;
    scope: string;
    space: string;
    type: string;
    name: string;
  }): Promise<Entity> {
    return this.prisma.entity.upsert({
      where: {
        userId_scope_space_type_name: {
          userId: params.userId,
          scope: params.scope,
          space: params.space,
          type: params.type,
          name: params.name,
        },
      },
      create: { ...params },
      update: {},
    });
  }
}
