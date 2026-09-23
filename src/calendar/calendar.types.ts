export const CALENDAR_EVENT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const CALENDAR_SCOPES = ['personal', 'professional'] as const;
