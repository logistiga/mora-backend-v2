import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MoraCalendarProvider } from './mora-calendar.provider.js';

function buildProvider() {
  const prismaMock = {
    calendarEvent: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    calendarEventParticipant: { createMany: vi.fn() },
  };
  const provider = new MoraCalendarProvider(prismaMock as never);
  return { provider, prismaMock };
}

const baseEvent = {
  id: 'e1',
  userId: 'u1',
  scope: 'personal',
  space: 'personal',
  title: 'x',
  description: null,
  location: null,
  startsAt: new Date('2026-09-24T09:00:00Z'),
  endsAt: new Date('2026-09-24T09:30:00Z'),
  timezone: 'UTC',
  status: 'confirmed',
  recurrenceRule: null,
  source: 'mora',
};

describe('MoraCalendarProvider', () => {
  let ctx: ReturnType<typeof buildProvider>;

  beforeEach(() => {
    ctx = buildProvider();
  });

  it('updateEvent() throws ForbiddenException for another user\'s event', async () => {
    ctx.prismaMock.calendarEvent.findUnique.mockResolvedValue({ ...baseEvent, userId: 'someone-else' });
    await expect(ctx.provider.updateEvent('u1', 'e1', { title: 'y' })).rejects.toThrow(ForbiddenException);
  });

  it('cancelEvent() throws NotFoundException for a missing event', async () => {
    ctx.prismaMock.calendarEvent.findUnique.mockResolvedValue(null);
    await expect(ctx.provider.cancelEvent('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('findFreeSlots() excludes a window already occupied by an existing event', async () => {
    ctx.prismaMock.calendarEvent.findMany.mockResolvedValue([baseEvent]);

    const slots = await ctx.provider.findFreeSlots(
      'u1',
      'personal',
      'personal',
      new Date('2026-09-24T08:00:00Z'),
      new Date('2026-09-24T12:00:00Z'),
      30,
    );

    const overlapsBusy = slots.some(
      (s) => s.startsAt < baseEvent.endsAt && s.endsAt > baseEvent.startsAt,
    );
    expect(overlapsBusy).toBe(false);
    expect(slots.length).toBeGreaterThan(0); // still finds slots around the busy window
  });

  it('getEvent() returns null (not another user\'s event) when userId does not match', async () => {
    ctx.prismaMock.calendarEvent.findUnique.mockResolvedValue({ ...baseEvent, userId: 'someone-else' });
    const result = await ctx.provider.getEvent('u1', 'e1');
    expect(result).toBeNull();
  });
});
