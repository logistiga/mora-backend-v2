import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleContactsPushService } from './google-contacts-push.service.js';

export const GOOGLE_CONTACTS_SYNC_QUEUE = 'google-contacts-sync';
const SCHEDULER_ID = 'google-contacts-sync-every-30min';
const SYNC_EVERY_MS = 30 * 60 * 1000;

/**
 * Keeps Google and Mora's contact books in step, every 30 minutes, for every
 * connected Google account: Google contacts are imported into Mora, then
 * Mora's new personal contacts are pushed to Google. Both steps are
 * idempotent, so a repeated run never duplicates anyone.
 */
@Processor(GOOGLE_CONTACTS_SYNC_QUEUE)
export class GoogleContactsSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(GoogleContactsSyncProcessor.name);

  constructor(
    @InjectQueue(GOOGLE_CONTACTS_SYNC_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly contactsSync: GoogleContactsSyncService,
    private readonly contactsPush: GoogleContactsPushService,
  ) {
    super();
  }

  /** Registers the repeatable schedule once at boot; re-registering the same id just updates it. */
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: SYNC_EVERY_MS }, { name: 'sync-all' });
  }

  async process(_job: Job): Promise<void> {
    const accounts = await this.prisma.googleAccount.findMany({ select: { userId: true } });
    for (const { userId } of accounts) {
      try {
        const pulled = await this.contactsSync.sync(userId);
        const pushed = await this.contactsPush.push(userId);
        this.logger.log(
          `Google contacts sync done: imported=${pulled.imported} renamed=${pulled.renamed} pushed=${pushed.pushed} failed=${pushed.failed}`,
        );
      } catch (error) {
        // One broken account (revoked token, missing write scope) must not stop the others.
        this.logger.warn(`Google contacts sync failed for one account: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }
}
