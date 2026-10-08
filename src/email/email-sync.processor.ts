import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { EmailMessageService } from './email-message.service.js';
import { EMAIL_SYNC_EVERY_MS, EMAIL_SYNC_JOB, EMAIL_SYNC_QUEUE, EMAIL_SYNC_SCHEDULER_ID } from './email-sync.constants.js';

/**
 * Pulls new mail for every connected mailbox every 15 minutes, instead of
 * only when the user opens the Email page and clicks sync. Each inbound
 * e-mail is read for durable facts as it comes in (EmailMessageService),
 * same as a document.
 */
@Processor(EMAIL_SYNC_QUEUE)
export class EmailSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  constructor(
    @InjectQueue(EMAIL_SYNC_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly messageService: EmailMessageService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(EMAIL_SYNC_SCHEDULER_ID, { every: EMAIL_SYNC_EVERY_MS }, { name: EMAIL_SYNC_JOB });
  }

  async process(_job: Job): Promise<void> {
    const accounts = await this.prisma.emailAccount.findMany({ select: { id: true, userId: true } });
    for (const account of accounts) {
      try {
        const ingested = await this.messageService.syncInbound(account.userId, account.id);
        if (ingested > 0) this.logger.log(`E-mail sync: ${ingested} new message(s) for one account`);
      } catch (error) {
        // One broken mailbox (bad credentials, provider outage) must not stop the others.
        this.logger.warn(`E-mail sync failed for one account: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }
}
