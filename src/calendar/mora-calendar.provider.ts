import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CalendarEventInput,
  CalendarEventRecord,
  CalendarProviderInterface,
  FreeSlot,
} from './calendar-provider.interface.js';

const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 18;

@Injectable()
export class MoraCalendarProvider implements CalendarProviderInterface {
  readonly provider = 'mora';

  constructor(private readonly prisma: PrismaService) {}

  async createEvent(input: CalendarEventInput): Promise<CalendarEventRecord> {
    const event = await this.prisma.calendarEvent.create({
      data: {
        userId: input.userId,
        scope: input.scope,
        space: input.space,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
        recurrenceRule: input.recurrenceRule,
        source: 'mora',
      },
    });

    if (input.participants?.length) {
      await this.prisma.calendarEventParticipant.createMany({
        data: input.participants.map((p) => ({
          eventId: event.id,
          contactId: p.contactId,
          name: p.name,
          email: p.email,
        })),
      });
    }

    return toRecord(event);
  }

  async updateEvent(userId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<CalendarEventRecord> {
    await this.assertOwned(userId, eventId);
    const updated = await this.prisma.calendarEvent.update({
      where: { id: eventId },
      data: {
        title: patch.title,
        description: patch.description,
        location: patch.location,
        startsAt: patch.startsAt,
        endsAt: patch.endsAt,
        timezone: patch.timezone,
      },
    });
    return toRecord(updated);
  }

  async cancelEvent(userId: string, eventId: string): Promise<CalendarEventRecord> {
    await this.assertOwned(userId, eventId);
    const updated = await this.prisma.calendarEvent.update({ where: { id: eventId }, data: { status: 'cancelled' } });
    return toRecord(updated);
  }

  async listEvents(userId: string, scope: string, space: string, from: Date, to: Date): Promise<CalendarEventRecord[]> {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        userId,
        scope,
        space,
        status: { not: 'cancelled' },
        startsAt: { lte: to },
        endsAt: { gte: from },
      },
      orderBy: { startsAt: 'asc' },
    });
    return events.map(toRecord);
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventRecord | null> {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id: eventId } });
    if (!event || event.userId !== userId) return null;
    return toRecord(event);
  }

  /**
   * A simple, real free-slot finder within working hours (8h-18h in the
   * requested timezone's reference), scanning existing events in the
   * window and returning the gaps — no external calendar to reconcile
   * against in Phase E.
   */
  async findFreeSlots(
    userId: string,
    scope: string,
    space: string,
    from: Date,
    to: Date,
    durationMinutes: number,
  ): Promise<FreeSlot[]> {
    const events = await this.listEvents(userId, scope, space, from, to);
    const busy = events.map((e) => ({ start: e.startsAt, end: e.endsAt })).sort((a, b) => a.start.getTime() - b.start.getTime());

    const slots: FreeSlot[] = [];
    let cursor = new Date(from);
    const durationMs = durationMinutes * 60_000;

    for (const block of busy) {
      if (block.start.getTime() - cursor.getTime() >= durationMs && withinWorkday(cursor)) {
        slots.push({ startsAt: new Date(cursor), endsAt: new Date(cursor.getTime() + durationMs) });
      }
      if (block.end > cursor) cursor = new Date(block.end);
    }
    if (to.getTime() - cursor.getTime() >= durationMs && withinWorkday(cursor)) {
      slots.push({ startsAt: new Date(cursor), endsAt: new Date(cursor.getTime() + durationMs) });
    }

    return slots.slice(0, 20);
  }

  private async assertOwned(userId: string, eventId: string): Promise<void> {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.userId !== userId) throw new ForbiddenException('This event does not belong to you');
  }
}

function withinWorkday(date: Date): boolean {
  const hour = date.getUTCHours();
  return hour >= WORKDAY_START_HOUR && hour < WORKDAY_END_HOUR;
}

function toRecord(event: {
  id: string;
  userId: string;
  scope: string;
  space: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  status: string;
  recurrenceRule: string | null;
  source: string;
}): CalendarEventRecord {
  return { ...event };
}
