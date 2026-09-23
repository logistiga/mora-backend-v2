import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingActionService } from './pending-action.service.js';

function basePendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa1',
    userId: 'u1',
    conversationId: 'c1',
    toolName: 'create_task',
    toolVersion: '1.0.0',
    scope: 'personal',
    space: 'personal',
    securityLevel: 'N2',
    input: { title: 'x' },
    status: 'pending',
    idempotencyKey: 'key-1',
    expiresAt: new Date(Date.now() + 60_000),
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService() {
  const prismaMock = {
    pendingAction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const toolExecutorMock = {
    executeNow: vi.fn(async () => ({ result: { ok: true, data: { id: 't1' } }, toolCallId: 'tc1' })),
  };
  const toolRegistryMock = {
    get: vi.fn(() => ({ name: 'create_task' })),
  };
  const auditMock = { log: vi.fn() };

  const service = new PendingActionService(
    prismaMock as never,
    toolExecutorMock as never,
    toolRegistryMock as never,
    auditMock as never,
  );
  return { service, prismaMock, toolExecutorMock, toolRegistryMock, auditMock };
}

describe('PendingActionService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('getById() throws ForbiddenException when the pending action belongs to another user', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction({ userId: 'someone-else' }));
    await expect(ctx.service.getById('u1', 'pa1')).rejects.toThrow(ForbiddenException);
  });

  it('getById() throws NotFoundException for a missing pending action', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(null);
    await expect(ctx.service.getById('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('approve() executes the tool and marks the pending action executed', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction());
    ctx.prismaMock.pendingAction.updateMany.mockResolvedValue({ count: 1 });
    ctx.prismaMock.pendingAction.update.mockResolvedValue(basePendingAction({ status: 'executed' }));

    const outcome = await ctx.service.approve('u1', 'pa1');
    expect(outcome.status).toBe('executed');
    expect(ctx.toolExecutorMock.executeNow).toHaveBeenCalledOnce();
    if (outcome.status === 'executed') {
      expect(outcome.toolResultOk).toBe(true);
    }
  });

  it('approve() never executes an expired pending action', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction({ expiresAt: new Date(Date.now() - 1000) }));
    ctx.prismaMock.pendingAction.updateMany.mockResolvedValue({ count: 1 });
    ctx.prismaMock.pendingAction.findUniqueOrThrow.mockResolvedValue(basePendingAction({ status: 'expired' }));

    const outcome = await ctx.service.approve('u1', 'pa1');
    expect(outcome.status).toBe('expired');
    expect(ctx.toolExecutorMock.executeNow).not.toHaveBeenCalled();
  });

  it('approve() called twice concurrently: only the first claims the row, the second gets already_processed', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction());
    // First call claims it (count 1); second call's conditional UPDATE affects 0 rows.
    ctx.prismaMock.pendingAction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    ctx.prismaMock.pendingAction.update.mockResolvedValue(basePendingAction({ status: 'executed' }));
    ctx.prismaMock.pendingAction.findUniqueOrThrow.mockResolvedValue(basePendingAction({ status: 'executed' }));

    const [first, second] = await Promise.all([
      ctx.service.approve('u1', 'pa1'),
      ctx.service.approve('u1', 'pa1'),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['already_processed', 'executed']);
    // The tool must only ever have been executed once, no matter the race.
    expect(ctx.toolExecutorMock.executeNow).toHaveBeenCalledOnce();
  });

  it('approve() marks the action failed (never crashes) when the tool was unregistered since proposal', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction());
    ctx.prismaMock.pendingAction.updateMany.mockResolvedValue({ count: 1 });
    ctx.toolRegistryMock.get.mockReturnValueOnce(null as never);
    ctx.prismaMock.pendingAction.update.mockResolvedValue(basePendingAction({ status: 'failed' }));

    const outcome = await ctx.service.approve('u1', 'pa1');
    expect(outcome.status).toBe('executed'); // outcome kind is still "executed" (attempted), but...
    if (outcome.status === 'executed') {
      expect(outcome.toolResultOk).toBe(false);
    }
    expect(ctx.toolExecutorMock.executeNow).not.toHaveBeenCalled();
  });

  it('reject() marks the action rejected and never executes the tool', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction());
    ctx.prismaMock.pendingAction.updateMany.mockResolvedValue({ count: 1 });
    ctx.prismaMock.pendingAction.findUniqueOrThrow.mockResolvedValue(basePendingAction({ status: 'rejected' }));

    const outcome = await ctx.service.reject('u1', 'pa1');
    expect(outcome.status).toBe('rejected');
    expect(ctx.toolExecutorMock.executeNow).not.toHaveBeenCalled();
  });

  it('reject() after it was already approved returns already_processed, never un-does the execution', async () => {
    ctx.prismaMock.pendingAction.findUnique.mockResolvedValue(basePendingAction({ status: 'approved' }));
    ctx.prismaMock.pendingAction.updateMany.mockResolvedValue({ count: 0 });
    ctx.prismaMock.pendingAction.findUniqueOrThrow.mockResolvedValue(basePendingAction({ status: 'executed' }));

    const outcome = await ctx.service.reject('u1', 'pa1');
    expect(outcome.status).toBe('already_processed');
  });
});
