import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskService } from './task.service.js';

function buildService() {
  const prismaMock = {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const service = new TaskService(prismaMock as never);
  return { service, prismaMock };
}

describe('TaskService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() persists a task scoped to the caller', async () => {
    ctx.prismaMock.task.create.mockResolvedValue({ id: 't1', userId: 'u1', title: 'Appeler Jean' });
    const task = await ctx.service.create('u1', { scope: 'personal', space: 'personal', title: 'Appeler Jean' });
    expect(task.id).toBe('t1');
    expect(ctx.prismaMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', title: 'Appeler Jean' }) }),
    );
  });

  it('getById() throws NotFoundException for a missing task', async () => {
    ctx.prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(ctx.service.getById('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('getById() throws ForbiddenException for another user\'s task (isolation)', async () => {
    ctx.prismaMock.task.findUnique.mockResolvedValue({ id: 't1', userId: 'someone-else' });
    await expect(ctx.service.getById('u1', 't1')).rejects.toThrow(ForbiddenException);
  });

  it('list() always scopes the query by userId', async () => {
    ctx.prismaMock.task.findMany.mockResolvedValue([]);
    await ctx.service.list('u1', {});
    expect(ctx.prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
    );
  });

  it('complete() sets status completed and completedAt', async () => {
    ctx.prismaMock.task.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
    ctx.prismaMock.task.update.mockResolvedValue({ id: 't1', status: 'completed' });
    const task = await ctx.service.complete('u1', 't1');
    expect(task.status).toBe('completed');
    expect(ctx.prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('cancel() refuses another user\'s task', async () => {
    ctx.prismaMock.task.findUnique.mockResolvedValue({ id: 't1', userId: 'someone-else' });
    await expect(ctx.service.cancel('u1', 't1')).rejects.toThrow(ForbiddenException);
  });
});
