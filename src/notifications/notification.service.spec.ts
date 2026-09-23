import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service.js';

function buildService() {
  const prismaMock = {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const service = new NotificationService(prismaMock as never);
  return { service, prismaMock };
}

describe('NotificationService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() persists a notification for the given user', async () => {
    ctx.prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
    await ctx.service.create({ userId: 'u1', type: 'reminder', title: 't', message: 'm' });
    expect(ctx.prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'reminder' }) }),
    );
  });

  it('markRead() throws ForbiddenException for another user\'s notification', async () => {
    ctx.prismaMock.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'someone-else' });
    await expect(ctx.service.markRead('u1', 'n1')).rejects.toThrow(ForbiddenException);
  });

  it('markRead() throws NotFoundException for a missing notification', async () => {
    ctx.prismaMock.notification.findUnique.mockResolvedValue(null);
    await expect(ctx.service.markRead('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('markAllRead() scopes the bulk update to unread notifications for that user only', async () => {
    ctx.prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });
    const count = await ctx.service.markAllRead('u1');
    expect(count).toBe(3);
    expect(ctx.prismaMock.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'unread' } }),
    );
  });
});
