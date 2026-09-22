import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditLogInput {
  userId?: string;
  conversationId?: string;
  action: string;
  scope?: string;
  space?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditEntry.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        action: input.action,
        scope: input.scope,
        space: input.space,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
