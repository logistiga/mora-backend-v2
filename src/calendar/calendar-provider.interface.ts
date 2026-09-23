export interface CalendarEventInput {
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  recurrenceRule?: string;
  participants?: { contactId?: string; name?: string; email?: string }[];
}

export interface CalendarEventRecord {
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
}

export interface FreeSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Provider abstraction (AGENTS Phase E §40): `MoraCalendarProvider` (internal,
 * fully functional, no external credentials needed) is the only
 * implementation Phase E ships. `GoogleCalendarProvider`/
 * `MicrosoftCalendarProvider` would implement the same interface without
 * touching CalendarService or any tool — not built here since no real
 * OAuth credentials are available to test against (documented limitation).
 */
export interface CalendarProviderInterface {
  readonly provider: string;

  createEvent(input: CalendarEventInput): Promise<CalendarEventRecord>;
  updateEvent(userId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<CalendarEventRecord>;
  cancelEvent(userId: string, eventId: string): Promise<CalendarEventRecord>;
  listEvents(userId: string, scope: string, space: string, from: Date, to: Date): Promise<CalendarEventRecord[]>;
  getEvent(userId: string, eventId: string): Promise<CalendarEventRecord | null>;
  findFreeSlots(userId: string, scope: string, space: string, from: Date, to: Date, durationMinutes: number): Promise<FreeSlot[]>;
}
