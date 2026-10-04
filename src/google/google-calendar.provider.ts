import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CalendarEventInput,
  CalendarEventRecord,
  CalendarProviderInterface,
  FreeSlot,
} from '../calendar/calendar-provider.interface.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR = 'primary';
const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 18;

interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Google Calendar behind the same CalendarProviderInterface as the internal
 * Mora calendar, over the REST API with the user's OAuth token. Events Mora
 * creates carry `mora_scope` / `mora_space` as private extended properties so
 * scope isolation survives the round-trip; events created directly in Google
 * have no such label and appear in every listing of their user.
 */
@Injectable()
export class GoogleCalendarProvider implements CalendarProviderInterface {
  readonly provider = 'google';

  constructor(private readonly oauth: GoogleOAuthService) {}

  async createEvent(input: CalendarEventInput): Promise<CalendarEventRecord> {
    const created = await this.request<GoogleEvent>(input.userId, 'POST', `/calendars/${CALENDAR}/events`, {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
      recurrence: input.recurrenceRule ? [input.recurrenceRule] : undefined,
      extendedProperties: { private: { mora_scope: input.scope, mora_space: input.space } },
    });
    return this.toRecord(input.userId, created, input.scope, input.space);
  }

  async updateEvent(userId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<CalendarEventRecord> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.startsAt) body.start = { dateTime: patch.startsAt.toISOString(), timeZone: patch.timezone };
    if (patch.endsAt) body.end = { dateTime: patch.endsAt.toISOString(), timeZone: patch.timezone };
    const updated = await this.request<GoogleEvent>(userId, 'PATCH', `/calendars/${CALENDAR}/events/${encodeURIComponent(eventId)}`, body);
    return this.toRecord(userId, updated, patch.scope ?? 'personal', patch.space ?? 'personal');
  }

  async cancelEvent(userId: string, eventId: string): Promise<CalendarEventRecord> {
    const existing = await this.getEvent(userId, eventId);
    if (!existing) throw new NotFoundException(`Event ${eventId} not found`);
    await this.request<unknown>(userId, 'DELETE', `/calendars/${CALENDAR}/events/${encodeURIComponent(eventId)}`);
    return { ...existing, status: 'cancelled' };
  }

  async listEvents(
    userId: string,
    scope: string,
    space: string | undefined,
    from: Date,
    to: Date,
  ): Promise<CalendarEventRecord[]> {
    const query = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const page = await this.request<{ items?: GoogleEvent[] }>(userId, 'GET', `/calendars/${CALENDAR}/events?${query}`);
    return (page.items ?? [])
      .filter((event) => this.matchesScope(event, scope, space))
      .map((event) => this.toRecord(userId, event, scope, space ?? 'general'));
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventRecord | null> {
    try {
      const event = await this.request<GoogleEvent>(userId, 'GET', `/calendars/${CALENDAR}/events/${encodeURIComponent(eventId)}`);
      return this.toRecord(userId, event, 'personal', 'general');
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  async findFreeSlots(
    userId: string,
    _scope: string,
    _space: string,
    from: Date,
    to: Date,
    durationMinutes: number,
  ): Promise<FreeSlot[]> {
    const response = await this.request<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(
      userId,
      'POST',
      '/freeBusy',
      { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: CALENDAR }] },
    );
    const busy = (response.calendars?.[CALENDAR]?.busy ?? [])
      .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
      .sort((a, b) => a.start - b.start);

    const durationMs = durationMinutes * 60 * 1000;
    const slots: FreeSlot[] = [];
    let cursor = from.getTime();
    for (const b of busy) {
      if (b.start - cursor >= durationMs) slots.push({ startsAt: new Date(cursor), endsAt: new Date(b.start) });
      cursor = Math.max(cursor, b.end);
    }
    if (to.getTime() - cursor >= durationMs) slots.push({ startsAt: new Date(cursor), endsAt: new Date(to.getTime()) });
    return slots.filter((s) => {
      const hour = s.startsAt.getUTCHours();
      return hour >= WORKDAY_START_HOUR && hour < WORKDAY_END_HOUR;
    });
  }

  private matchesScope(event: GoogleEvent, scope: string, space: string | undefined): boolean {
    const labels = event.extendedProperties?.private ?? {};
    if (!labels.mora_scope) return true;
    if (labels.mora_scope !== scope) return false;
    return space === undefined || labels.mora_space === space;
  }

  private toRecord(userId: string, event: GoogleEvent, fallbackScope: string, fallbackSpace: string): CalendarEventRecord {
    const labels = event.extendedProperties?.private ?? {};
    const startRaw = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00Z` : new Date(0).toISOString());
    const endRaw = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00Z` : startRaw);
    return {
      id: event.id,
      userId,
      scope: labels.mora_scope ?? fallbackScope,
      space: labels.mora_space ?? fallbackSpace,
      title: event.summary ?? '(sans titre)',
      description: event.description ?? null,
      location: event.location ?? null,
      startsAt: new Date(startRaw),
      endsAt: new Date(endRaw),
      timezone: event.start?.timeZone ?? 'UTC',
      status: event.status ?? 'confirmed',
      recurrenceRule: event.recurrence?.[0] ?? null,
      source: 'google',
    };
  }

  private async request<T>(userId: string, method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.oauth.getAccessToken(userId);
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) throw new NotFoundException('Google event not found');
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar API ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
