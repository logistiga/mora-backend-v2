import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../../notifications/notification.service.js';
import { REMINDER_DELIVERY_QUEUE, type ReminderDeliveryJobData } from '../reminder-queue.constants.js';

/**
 * Delivers a due reminder as exactly one internal notification (Phase D:
 * notification only — no email/WhatsApp/push, see AGENTS §16). Idempotent
 * against BullMQ retries: the reminder's `status` is only flipped
 * `scheduled -> delivered` via a conditional update (`WHERE status =
 * 'scheduled'`); if a retry runs after a prior attempt already delivered
 * (e.g. the notification write succeeded but the job was retried anyway),
 * the conditional update affects 0 rows and no second notification is created.
 */
@Processor(REMINDER_DELIVERY_QUEUE)
export class ReminderDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async process(job: Job<ReminderDeliveryJobData>): Promise<{ delivered: boolean; reason?: string }> {
    const { reminderId, userId } = job.data;
    this.logger.debug(
      `Processing reminder ${reminderId} (requestId=${job.data.requestId ?? 'n/a'}, jobId=${job.id ?? 'n/a'})`,
    );

    const reminder = await this.prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder || reminder.userId !== userId) {
      this.logger.warn(`Delivery job for missing/foreign reminder ${reminderId}, skipping`);
      return { delivered: false, reason: 'reminder_not_found' };
    }

    if (reminder.status === 'delivered') {
      this.logger.debug(`Reminder ${reminderId} already delivered, skipping duplicate delivery`);
      return { delivered: false, reason: 'already_delivered' };
    }
    if (reminder.status === 'cancelled') {
      return { delivered: false, reason: 'cancelled' };
    }

    // Atomic conditional transition — the real idempotence guard against a
    // retried/duplicated delivery job (see class doc above).
    const claim = await this.prisma.reminder.updateMany({
      where: { id: reminderId, status: 'scheduled' },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
    if (claim.count === 0) {
      this.logger.debug(`Reminder ${reminderId} delivery already claimed by another attempt`);
      return { delivered: false, reason: 'already_claimed' };
    }

    await this.notificationService.create({
      userId,
      type: 'reminder',
      title: reminder.title,
      message: reminder.message ?? reminder.title,
      metadata: { reminderId: reminder.id, scope: reminder.scope, space: reminder.space },
    });

    this.logger.debug(`Delivered reminder ${reminderId} as a notification`);
    return { delivered: true };
  }
}
