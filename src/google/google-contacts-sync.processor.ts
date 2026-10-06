import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';

export const GOOGLE_CONTACTS_SYNC_QUEUE = 'google-contacts-sync';
const SCHEDULER_ID = 'google-contacts-sync-every-6h';
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the contact book up to date: every 6 hours, each connected Google
 * account's contacts are imported again (new contacts added, renames applied).
 * The sync itself is idempotent, so a repeated run never duplicates anyone.
 */
@Processor(GOOGLE_CONTACTS_SYNC_QUEUE)
export class GoogleContactsSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(GoogleContactsSyncProcessor.name);

  constructor(
    @InjectQueue(GOOGLE_CONTACTS_SYNC_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly contactsSync: GoogleContactsSyncService,
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
        const result = await this.contactsSync.sync(userId);
        this.logger.log(`Google contacts sync done: imported=${result.imported} renamed=${result.renamed}`);
      } catch (error) {
        // One broken account (revoked token, Google outage) must not stop the others.
        this.logger.warn(`Google contacts sync failed for one account: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }
}
