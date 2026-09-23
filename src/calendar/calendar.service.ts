import { Inject, Injectable } from '@nestjs/common';
import { TimeContextService } from '../common/time/time-context.service.js';
import type {
  CalendarEventInput,
  CalendarEventRecord,
  CalendarProviderInterface,
  FreeSlot,
} from './calendar-provider.interface.js';
import { CALENDAR_PROVIDER } from './calendar-provider.token.js';

/**
 * Thin wrapper around the active CalendarProviderInterface (Mora-only in
 * Phase E). Timezone is never left implicit (AGENTS Phase E §42, and the
 * exact bug class Phase D's TimeContextService correction fixed): every
 * event gets `TimeContextService.timezone` (the same explicit, documented
 * default the LLM's date reference already uses) unless the caller passed
 * one.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(CALENDAR_PROVIDER) private readonly provider: CalendarProviderInterface,
    private readonly timeContext: TimeContextService,
  ) {}

  async createEvent(input: Omit<CalendarEventInput, 'timezone'> & { timezone?: string }): Promise<CalendarEventRecord> {
    return this.provider.createEvent({ ...input, timezone: input.timezone ?? this.timeContext.timezone });
  }

  async updateEvent(userId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<CalendarEventRecord> {
    return this.provider.updateEvent(userId, eventId, patch);
  }

  async cancelEvent(userId: string, eventId: string): Promise<CalendarEventRecord> {
    return this.provider.cancelEvent(userId, eventId);
  }

  async listEvents(userId: string, scope: string, space: string, from: Date, to: Date): Promise<CalendarEventRecord[]> {
    return this.provider.listEvents(userId, scope, space, from, to);
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventRecord | null> {
    return this.provider.getEvent(userId, eventId);
  }

  async findFreeSlots(userId: string, scope: string, space: string, from: Date, to: Date, durationMinutes: number): Promise<FreeSlot[]> {
    return this.provider.findFreeSlots(userId, scope, space, from, to, durationMinutes);
  }
}
