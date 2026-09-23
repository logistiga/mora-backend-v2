export const REMINDER_STATUSES = ['scheduled', 'delivered', 'cancelled', 'failed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_SCOPES = ['personal', 'professional'] as const;
