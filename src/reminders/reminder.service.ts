import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Reminder } from '../generated/prisma/client.js';
import type { CreateReminderDto } from './dto/create-reminder.dto.js';
import type { ListRemindersQueryDto } from './dto/list-reminders.dto.js';
import {
  REMINDER_DELIVERY_JOB,
  REMINDER_DELIVERY_QUEUE,
  REMINDER_JOB_DEFAULT_OPTIONS,
} from './queue/reminder-queue.constants.js';

const LIST_LIMIT = 100;

/**
 * Schedules delivery through the existing BullMQ infrastructure (Phase C's
 * QueueModule sets up the Redis connection once, globally) — no parallel
 * queue system (AGENTS Phase D §15).
 *
 * Idempotence: the delayed job's BullMQ `jobId` is the reminder's own id.
 * BullMQ treats `queue.add()` with a `jobId` that already exists in the
 * queue as a no-op returning the existing job rather than creating a
 * duplicate, so a retried/duplicated `create()` call can never schedule two
 * deliveries for the same reminder.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(REMINDER_DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  async create(
    userId: string,
    dto: CreateReminderDto,
    source: 'manual' | 'tool' = 'manual',
    sourceConversationId?: string,
  ): Promise<Reminder> {
    const remindAt = new Date(dto.remindAt);
    const delayMs = Math.max(0, remindAt.getTime() - Date.now());

    const reminder = await this.prisma.reminder.create({
      data: {
        userId,
        scope: dto.scope,
        space: dto.space,
        title: dto.title,
        message: dto.message,
        remindAt,
        source,
        sourceConversationId,
      },
    });

    await this.deliveryQueue.add(
      REMINDER_DELIVERY_JOB,
      { reminderId: reminder.id, userId },
      { ...REMINDER_JOB_DEFAULT_OPTIONS, delay: delayMs, jobId: reminder.id },
    );

    return this.prisma.reminder.update({
      where: { id: reminder.id },
      data: { bullJobId: reminder.id },
    });
  }

  async list(userId: string, query: ListRemindersQueryDto): Promise<Reminder[]> {
    const where: Prisma.ReminderWhereInput = { userId };
    if (query.scope) where.scope = query.scope;
    if (query.space) where.space = query.space;
    if (query.status) where.status = query.status;

    return this.prisma.reminder.findMany({
      where,
      orderBy: [{ remindAt: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  async getById(userId: string, id: string): Promise<Reminder> {
    const reminder = await this.prisma.reminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.userId !== userId) throw new ForbiddenException('This reminder does not belong to you');
    return reminder;
  }

  async cancel(userId: string, id: string): Promise<Reminder> {
    const reminder = await this.getById(userId, id);
    if (reminder.status !== 'scheduled') {
      return reminder; // already delivered/cancelled/failed — idempotent no-op
    }

    if (reminder.bullJobId) {
      const job = await this.deliveryQueue.getJob(reminder.bullJobId);
      if (job) {
        await job.remove().catch((error: unknown) => {
          this.logger.warn(`Failed to remove BullMQ job ${reminder.bullJobId}: ${String(error)}`);
        });
      }
    }

    return this.prisma.reminder.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }
}
