import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderService } from './reminder.service.js';

function buildService() {
  const prismaMock = {
    reminder: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  const queueMock = {
    add: vi.fn(async () => ({ id: 'job-1' })),
    getJob: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  };
  const service = new ReminderService(prismaMock as never, queueMock as never);
  return { service, prismaMock, queueMock };
}

describe('ReminderService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() persists the reminder and schedules a BullMQ delayed job keyed by the reminder id', async () => {
    ctx.prismaMock.reminder.create.mockResolvedValue({ id: 'r1', userId: 'u1' });
    ctx.prismaMock.reminder.update.mockResolvedValue({ id: 'r1', bullJobId: 'r1' });

    const remindAt = new Date(Date.now() + 60_000).toISOString();
    await ctx.service.create('u1', { scope: 'personal', space: 'personal', title: 'Vérifier', remindAt });

    expect(ctx.queueMock.add).toHaveBeenCalledWith(
      'deliver-reminder',
      { reminderId: 'r1', userId: 'u1' },
      expect.objectContaining({ jobId: 'r1' }),
    );
  });

  it('create() never schedules a negative delay for a past remindAt — clamps to 0', async () => {
    ctx.prismaMock.reminder.create.mockResolvedValue({ id: 'r1', userId: 'u1' });
    ctx.prismaMock.reminder.update.mockResolvedValue({ id: 'r1' });

    await ctx.service.create('u1', {
      scope: 'personal',
      space: 'personal',
      title: 'x',
      remindAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const call = ctx.queueMock.add.mock.calls[0] as unknown[];
    const options = call[2] as { delay: number };
    expect(options.delay).toBe(0);
  });

  it('getById() throws ForbiddenException for another user\'s reminder', async () => {
    ctx.prismaMock.reminder.findUnique.mockResolvedValue({ id: 'r1', userId: 'someone-else' });
    await expect(ctx.service.getById('u1', 'r1')).rejects.toThrow(ForbiddenException);
  });

  it('getById() throws NotFoundException for a missing reminder', async () => {
    ctx.prismaMock.reminder.findUnique.mockResolvedValue(null);
    await expect(ctx.service.getById('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('cancel() removes the BullMQ job and marks the reminder cancelled', async () => {
    ctx.prismaMock.reminder.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      status: 'scheduled',
      bullJobId: 'r1',
    });
    ctx.prismaMock.reminder.update.mockResolvedValue({ id: 'r1', status: 'cancelled' });

    const result = await ctx.service.cancel('u1', 'r1');
    expect(result.status).toBe('cancelled');
    expect(ctx.queueMock.getJob).toHaveBeenCalledWith('r1');
  });

  it('cancel() is a no-op (idempotent) on an already-delivered reminder', async () => {
    ctx.prismaMock.reminder.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'delivered' });

    const result = await ctx.service.cancel('u1', 'r1');
    expect(result.status).toBe('delivered');
    expect(ctx.prismaMock.reminder.update).not.toHaveBeenCalled();
  });
});
