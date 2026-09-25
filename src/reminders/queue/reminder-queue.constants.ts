export const REMINDER_DELIVERY_QUEUE = 'reminder-delivery';
export const REMINDER_DELIVERY_JOB = 'deliver-reminder';

/**
 * Unlike the Phase C memory queues (which retry a failing LLM/embedding call
 * a few times), a reminder delivery job that fails is retried more
 * conservatively — a reminder firing a few minutes late is fine, but we
 * still never want it to be lost silently (AGENTS Phase D §18, §34).
 */
export const REMINDER_JOB_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export interface ReminderDeliveryJobData {
  reminderId: string;
  userId: string;
  requestId?: string;
}
