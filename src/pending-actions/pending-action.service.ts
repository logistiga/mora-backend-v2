import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PendingAction, Prisma } from '../generated/prisma/client.js';
import { ToolExecutorService } from '../tools/tool-executor.service.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import type { ToolScope } from '../tools/tool.types.js';

const LIST_LIMIT = 100;

export type ApproveOutcome =
  | { status: 'executed'; pendingAction: PendingAction; toolResultOk: boolean }
  | { status: 'already_processed'; pendingAction: PendingAction }
  | { status: 'expired'; pendingAction: PendingAction };

export type RejectOutcome =
  | { status: 'rejected'; pendingAction: PendingAction }
  | { status: 'already_processed'; pendingAction: PendingAction };

export type CancelOutcome =
  | { status: 'cancelled'; pendingAction: PendingAction }
  | { status: 'already_processed'; pendingAction: PendingAction };

/**
 * Owns the pending_action lifecycle (pending -> approved -> executed, or
 * pending -> rejected, or pending -> expired). This is the ONLY place a
 * pending N2/N3 tool call is ever actually executed — never directly from a
 * controller, never by the LLM (AGENTS Phase D §10, §24). approve()/reject()
 * are plain backend commands triggered by an authenticated REST call; no
 * "approve_pending_action" tool is ever exposed to the LLM (AGENTS §11),
 * which would let a model auto-confirm its own proposal.
 *
 * Idempotence / concurrency: both approve() and reject() use a single atomic
 * conditional UPDATE (`WHERE status = 'pending'`) to claim the transition.
 * Two near-simultaneous approve() calls race on that UPDATE; exactly one
 * affects a row and proceeds to execute, the other sees 0 rows affected and
 * returns `already_processed` with the current (already executed) state —
 * never a second execution, never a race window (AGENTS §9, §33).
 */
@Injectable()
export class PendingActionService {
  private readonly logger = new Logger(PendingActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
  }

  async getById(userId: string, id: string): Promise<PendingAction> {
    const pendingAction = await this.prisma.pendingAction.findUnique({ where: { id } });
    if (!pendingAction) throw new NotFoundException('Pending action not found');
    if (pendingAction.userId !== userId) {
      // A pending action strictly belongs to its own user — User B can never
      // even learn a pending action of User A exists (AGENTS §8, §28).
      throw new ForbiddenException('This pending action does not belong to you');
    }
    return pendingAction;
  }

  async approve(userId: string, id: string): Promise<ApproveOutcome> {
    const pendingAction = await this.getById(userId, id);

    if (pendingAction.status === 'pending' && pendingAction.expiresAt && pendingAction.expiresAt < new Date()) {
      const expired = await this.prisma.pendingAction.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'expired' },
      });
      const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
      if (expired.count > 0) {
        await this.audit.log({
          userId,
          conversationId: pendingAction.conversationId ?? undefined,
          action: 'pending_action_expired',
          scope: pendingAction.scope,
          space: pendingAction.space,
          metadata: { pendingActionId: id },
        });
      }
      return { status: 'expired', pendingAction: current };
    }

    // Atomic claim: only the caller that flips pending -> approved proceeds.
    const claim = await this.prisma.pendingAction.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', approvedAt: new Date() },
    });

    if (claim.count === 0) {
      const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
      return { status: 'already_processed', pendingAction: current };
    }

    await this.audit.log({
      userId,
      conversationId: pendingAction.conversationId ?? undefined,
      action: 'pending_action_approved',
      scope: pendingAction.scope,
      space: pendingAction.space,
      metadata: { pendingActionId: id, toolName: pendingAction.toolName },
    });

    const tool = this.toolRegistry.get(pendingAction.toolName);
    if (!tool) {
      // Tool was unregistered/renamed between proposal and approval — fail
      // safe rather than crash.
      const failed = await this.prisma.pendingAction.update({
        where: { id },
        data: { status: 'failed' },
      });
      return { status: 'executed', pendingAction: failed, toolResultOk: false };
    }

    const { result } = await this.toolExecutor.executeNow(tool, {
      userId,
      conversationId: pendingAction.conversationId ?? undefined,
      scope: pendingAction.scope as ToolScope,
      space: pendingAction.space,
      route: pendingAction.scope,
      pendingActionId: pendingAction.id,
    }, pendingAction.input);

    const finalState = await this.prisma.pendingAction.update({
      where: { id },
      data: {
        status: result.ok ? 'executed' : 'failed',
        executedAt: new Date(),
        result: (result.data ?? { errorCode: result.errorCode, errorMessage: result.errorMessage }) as Prisma.InputJsonValue,
      },
    });

    return { status: 'executed', pendingAction: finalState, toolResultOk: result.ok };
  }

  async reject(userId: string, id: string): Promise<RejectOutcome> {
    const pendingAction = await this.getById(userId, id);

    // Atomic claim — same guard as approve(): reject() must NEVER execute
    // the tool, and a reject racing an approve must not corrupt state.
    const claim = await this.prisma.pendingAction.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', rejectedAt: new Date() },
    });

    if (claim.count === 0) {
      const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
      return { status: 'already_processed', pendingAction: current };
    }

    await this.audit.log({
      userId,
      conversationId: pendingAction.conversationId ?? undefined,
      action: 'pending_action_rejected',
      scope: pendingAction.scope,
      space: pendingAction.space,
      metadata: { pendingActionId: id, toolName: pendingAction.toolName },
    });

    const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
    return { status: 'rejected', pendingAction: current };
  }

  async cancel(userId: string, id: string, reason = 'voice_interrupted'): Promise<CancelOutcome> {
    const pendingAction = await this.getById(userId, id);

    const claim = await this.prisma.pendingAction.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'cancelled',
        result: { cancelledReason: reason } as Prisma.InputJsonValue,
      },
    });

    if (claim.count === 0) {
      const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
      return { status: 'already_processed', pendingAction: current };
    }

    await this.audit.log({
      userId,
      conversationId: pendingAction.conversationId ?? undefined,
      action: 'pending_action_cancelled',
      scope: pendingAction.scope,
      space: pendingAction.space,
      metadata: { pendingActionId: id, toolName: pendingAction.toolName, reason },
    });

    const current = await this.prisma.pendingAction.findUniqueOrThrow({ where: { id } });
    return { status: 'cancelled', pendingAction: current };
  }
}
