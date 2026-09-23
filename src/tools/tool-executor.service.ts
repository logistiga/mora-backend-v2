import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionService } from './permission.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import type { MoraTool, ToolContext, ToolResult } from './tool.types.js';

export type ToolRequestOutcome =
  | { kind: 'executed'; result: ToolResult; toolCallId: string }
  | { kind: 'pending_confirmation'; pendingActionId: string; summary: string; securityLevel: string }
  | { kind: 'rejected'; reason: string };

/**
 * Mandatory pipeline for EVERY tool invocation, whether it comes from the LLM
 * (via the orchestrator) or a REST endpoint acting on the user's own explicit
 * behalf (AGENTS Phase D §5, §22). No controller and no LLM code ever calls
 * `tool.execute()` directly.
 *
 * Pipeline: lookup -> validate input -> PermissionService -> security level
 * -> confirmation policy (N1 executes now, N2/N3 create a pending_action,
 * N4 is refused) -> idempotency check -> execute -> persist tool_call ->
 * audit -> normalized result.
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly permissions: PermissionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Entry point for an LLM-proposed tool call, or any caller that wants the
   * full confirmation policy applied (N1 auto, N2/N3 pending, N4 blocked).
   * A direct REST create (e.g. POST /tasks) does NOT go through this method
   * — see TaskService/ReminderService, which call `executeDirect` instead,
   * because the REST call itself is the user's explicit confirmation
   * (AGENTS Phase D §22 recommendation, documented in FRONTEND_HANDOFF.md).
   */
  async requestExecution(
    toolName: string,
    rawInput: unknown,
    context: ToolContext,
  ): Promise<ToolRequestOutcome> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      await this.audit.log({
        userId: context.userId,
        conversationId: context.conversationId,
        action: 'tool_call_unknown_tool',
        scope: context.scope,
        space: context.space,
        metadata: { toolName },
      });
      return { kind: 'rejected', reason: 'unknown_tool' };
    }

    const validation = tool.validate(rawInput);
    if (!validation.valid) {
      await this.recordCall(context, tool, rawInput, {
        status: 'failed',
        errorCode: 'invalid_arguments',
      });
      return { kind: 'rejected', reason: `invalid_arguments: ${validation.errors?.join('; ')}` };
    }

    const permission = this.permissions.check(context, tool);
    if (!permission.allowed) {
      await this.recordCall(context, tool, validation.value, {
        status: 'rejected',
        errorCode: permission.reason,
      });
      return { kind: 'rejected', reason: permission.reason ?? 'not_allowed' };
    }

    if (tool.securityLevel === 'N4') {
      // Belt-and-braces: PermissionService already blocks N4, but the
      // confirmation policy itself must never route N4 to execution even if
      // a future PermissionService change loosened the check above.
      await this.recordCall(context, tool, validation.value, {
        status: 'rejected',
        errorCode: 'security_level_n4_blocked',
      });
      return { kind: 'rejected', reason: 'security_level_n4_blocked' };
    }

    if (tool.securityLevel === 'N1' && !tool.requiresConfirmation) {
      const outcome = await this.executeNow(tool, context, validation.value);
      return { kind: 'executed', result: outcome.result, toolCallId: outcome.toolCallId };
    }

    // N2/N3: never execute here — create a pending_action and hand back a
    // summary so the caller (orchestrator) can ask for confirmation.
    const idempotencyKey = randomUUID();
    const pendingAction = await this.prisma.pendingAction.create({
      data: {
        userId: context.userId,
        conversationId: context.conversationId,
        toolName: tool.name,
        toolVersion: tool.version,
        scope: context.scope,
        space: context.space,
        securityLevel: tool.securityLevel,
        input: validation.value as Prisma.InputJsonValue,
        status: 'pending',
        idempotencyKey,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    await this.audit.log({
      userId: context.userId,
      conversationId: context.conversationId,
      action: 'pending_action_created',
      scope: context.scope,
      space: context.space,
      metadata: { pendingActionId: pendingAction.id, toolName: tool.name, securityLevel: tool.securityLevel },
    });

    return {
      kind: 'pending_confirmation',
      pendingActionId: pendingAction.id,
      summary: this.summarize(tool, validation.value),
      securityLevel: tool.securityLevel,
    };
  }

  /**
   * Executes an already-validated, already-permitted tool call immediately —
   * used for N1 tools (from requestExecution) and by PendingActionService
   * once a pending N2/N3 action has been approved. Never called with
   * unvalidated LLM input directly.
   */
  async executeNow(
    tool: MoraTool,
    context: ToolContext,
    input: unknown,
  ): Promise<{ result: ToolResult; toolCallId: string }> {
    const start = Date.now();
    const toolCall = await this.prisma.toolCall.create({
      data: {
        userId: context.userId,
        conversationId: context.conversationId,
        pendingActionId: context.pendingActionId,
        toolName: tool.name,
        toolVersion: tool.version,
        scope: context.scope,
        space: context.space,
        securityLevel: tool.securityLevel,
        input: input as Prisma.InputJsonValue,
        status: 'executing',
      },
    });

    try {
      const result = await tool.execute(context, input);
      const latencyMs = Date.now() - start;
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: {
          status: result.ok ? 'success' : 'failed',
          output: (result.data ?? null) as Prisma.InputJsonValue,
          errorCode: result.errorCode,
          latencyMs,
          completedAt: new Date(),
        },
      });
      await this.audit.log({
        userId: context.userId,
        conversationId: context.conversationId,
        action: result.ok ? 'tool_execution_success' : 'tool_execution_failed',
        scope: context.scope,
        space: context.space,
        metadata: { toolName: tool.name, toolCallId: toolCall.id, latencyMs },
      });
      return { result, toolCallId: toolCall.id };
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.logger.error(`Tool "${tool.name}" threw`, error instanceof Error ? error.stack : error);
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: {
          status: 'failed',
          errorCode: error instanceof Error ? error.constructor.name : 'UnknownError',
          latencyMs,
          completedAt: new Date(),
        },
      });
      await this.audit.log({
        userId: context.userId,
        conversationId: context.conversationId,
        action: 'tool_execution_failed',
        scope: context.scope,
        space: context.space,
        metadata: { toolName: tool.name, toolCallId: toolCall.id, latencyMs, threw: true },
      });
      return {
        result: { ok: false, errorCode: 'tool_exception', errorMessage: 'Tool execution failed' },
        toolCallId: toolCall.id,
      };
    }
  }

  private async recordCall(
    context: ToolContext,
    tool: MoraTool,
    input: unknown,
    fields: { status: string; errorCode?: string },
  ): Promise<void> {
    await this.prisma.toolCall.create({
      data: {
        userId: context.userId,
        conversationId: context.conversationId,
        pendingActionId: context.pendingActionId,
        toolName: tool.name,
        toolVersion: tool.version,
        scope: context.scope,
        space: context.space,
        securityLevel: tool.securityLevel,
        input: (input ?? {}) as Prisma.InputJsonValue,
        status: fields.status,
        errorCode: fields.errorCode,
        completedAt: new Date(),
      },
    });
  }

  private summarize(tool: MoraTool, input: unknown): string {
    const record = (input ?? {}) as Record<string, unknown>;
    switch (tool.name) {
      case 'create_task':
        return `Créer une tâche : "${String(record.title ?? '')}"`;
      case 'update_task':
        return `Modifier la tâche ${String(record.taskId ?? '')}`;
      case 'complete_task':
        return `Marquer la tâche ${String(record.taskId ?? '')} comme terminée`;
      case 'create_reminder':
        return `Créer un rappel : "${String(record.title ?? '')}" (${String(record.remindAt ?? '')})`;
      case 'cancel_reminder':
        return `Annuler le rappel ${String(record.reminderId ?? '')}`;
      default:
        return `Exécuter ${tool.name}`;
    }
  }
}
