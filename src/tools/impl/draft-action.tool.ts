import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IsObject, IsString, MinLength } from 'class-validator';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ToolRegistryService } from '../tool-registry.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class DraftActionInput {
  @IsString()
  @MinLength(1)
  targetTool: string;

  @IsObject()
  targetInput: Record<string, unknown>;
}

/**
 * Lets the LLM prepare an action for the user's review without ever
 * executing it (AGENTS Phase D §11): always creates a pending_action,
 * regardless of the target tool's own security level — even a target N1
 * tool is only drafted here, never run. This is distinct from calling the
 * target tool directly (which, for an N1 tool, WOULD execute immediately).
 */
@Injectable()
export class DraftActionTool implements MoraTool<DraftActionInput> {
  readonly name = 'draft_action';
  readonly description =
    "Prépare une action (nom du tool cible + arguments) pour révision par l'utilisateur, sans jamais l'exécuter.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      targetTool: { type: 'string', description: 'Nom exact du tool à préparer' },
      targetInput: { type: 'object', description: 'Arguments proposés pour ce tool' },
    },
    required: ['targetTool', 'targetInput'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  validate(input: unknown): ToolValidationResult<DraftActionInput> {
    return validateWithDto(DraftActionInput, input);
  }

  async execute(context: ToolContext, input: DraftActionInput): Promise<ToolResult> {
    const targetTool = this.registry.get(input.targetTool);
    if (!targetTool) {
      return { ok: false, errorCode: 'unknown_tool', errorMessage: `Unknown target tool "${input.targetTool}"` };
    }
    if (!targetTool.allowedScopes.includes(context.scope)) {
      return { ok: false, errorCode: 'scope_not_allowed' };
    }
    if (targetTool.securityLevel === 'N4') {
      return { ok: false, errorCode: 'security_level_n4_blocked' };
    }

    const targetValidation = targetTool.validate(input.targetInput);
    if (!targetValidation.valid) {
      return { ok: false, errorCode: 'invalid_arguments', errorMessage: targetValidation.errors?.join('; ') };
    }

    const pendingAction = await this.prisma.pendingAction.create({
      data: {
        userId: context.userId,
        conversationId: context.conversationId,
        toolName: targetTool.name,
        toolVersion: targetTool.version,
        scope: context.scope,
        space: context.space,
        securityLevel: targetTool.securityLevel,
        input: targetValidation.value as Prisma.InputJsonValue,
        status: 'pending',
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    await this.audit.log({
      userId: context.userId,
      conversationId: context.conversationId,
      action: 'pending_action_created',
      scope: context.scope,
      space: context.space,
      metadata: { pendingActionId: pendingAction.id, toolName: targetTool.name, drafted: true },
    });

    return { ok: true, data: { pendingActionId: pendingAction.id, toolName: targetTool.name } };
  }
}
