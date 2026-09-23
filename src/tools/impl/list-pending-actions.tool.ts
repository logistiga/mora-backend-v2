import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class ListPendingActionsInput {}

/**
 * Read-only, N1. Scoped to the current conversation's own scope/space like
 * every other tool here — a Professional conversation never gets to see a
 * Personal pending action's existence, even for the same user.
 */
@Injectable()
export class ListPendingActionsTool implements MoraTool<ListPendingActionsInput> {
  readonly name = 'list_pending_actions';
  readonly description = "Liste les actions en attente de confirmation de l'utilisateur, dans le scope/space courant.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(private readonly prisma: PrismaService) {}

  validate(input: unknown): ToolValidationResult<ListPendingActionsInput> {
    return validateWithDto(ListPendingActionsInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    const pendingActions = await this.prisma.pendingAction.findMany({
      where: { userId: context.userId, scope: context.scope, space: context.space, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { ok: true, data: pendingActions };
  }
}
