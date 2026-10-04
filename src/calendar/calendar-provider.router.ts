import { Injectable } from '@nestjs/common';
import { GoogleCalendarProvider } from '../google/google-calendar.provider.js';
import { UserSkillsService } from '../skills/user-skills.service.js';
import { MoraCalendarProvider } from './mora-calendar.provider.js';
import type {
  CalendarEventInput,
  CalendarEventRecord,
  CalendarProviderInterface,
  FreeSlot,
} from './calendar-provider.interface.js';

/**
 * Picks the calendar backend per user from the `calendar` skill config
 * (`provider: 'mora' | 'google'`, default `mora`). Nothing changes for a user
 * until they explicitly switch to Google, so existing agenda data is untouched.
 */
@Injectable()
export class CalendarProviderRouter implements CalendarProviderInterface {
  readonly provider = 'router';

  constructor(
    private readonly mora: MoraCalendarProvider,
    private readonly google: GoogleCalendarProvider,
    private readonly userSkills: UserSkillsService,
  ) {}

  private async target(userId: string): Promise<CalendarProviderInterface> {
    const config = await this.userSkills.getConfig(userId, 'calendar');
    return config.provider === 'google' ? this.google : this.mora;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventRecord> {
    return (await this.target(input.userId)).createEvent(input);
  }

  async updateEvent(userId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<CalendarEventRecord> {
    return (await this.target(userId)).updateEvent(userId, eventId, patch);
  }

  async cancelEvent(userId: string, eventId: string): Promise<CalendarEventRecord> {
    return (await this.target(userId)).cancelEvent(userId, eventId);
  }

  async listEvents(userId: string, scope: string, space: string | undefined, from: Date, to: Date): Promise<CalendarEventRecord[]> {
    return (await this.target(userId)).listEvents(userId, scope, space, from, to);
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventRecord | null> {
    return (await this.target(userId)).getEvent(userId, eventId);
  }

  async findFreeSlots(userId: string, scope: string, space: string, from: Date, to: Date, durationMinutes: number): Promise<FreeSlot[]> {
    return (await this.target(userId)).findFreeSlots(userId, scope, space, from, to, durationMinutes);
  }
}
