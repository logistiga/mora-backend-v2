import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, RouterDecision } from '../generated/prisma/client.js';
import type { RouterDecisionResult } from '../router/router.types.js';

@Injectable()
export class RouterDecisionsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    conversationId: string,
    messageId: string | undefined,
    decision: RouterDecisionResult,
  ): Promise<RouterDecision> {
    return this.prisma.routerDecision.create({
      data: {
        conversationId,
        messageId,
        route: decision.route,
        scope: decision.scope,
        space: decision.space,
        intent: decision.intent,
        complexity: decision.complexity,
        securityLevel: decision.securityLevel,
        confidence: decision.confidence,
        metadata: { method: decision.method } as Prisma.InputJsonValue,
      },
    });
  }

  /** Router decisions for conversations owned by `userId` only. */
  async listForUser(userId: string, limit = 50): Promise<RouterDecision[]> {
    return this.prisma.routerDecision.findMany({
      where: { conversation: { userId } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
