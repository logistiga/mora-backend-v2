import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTACT_REMOTE_QUEUE, REMOTE_DELETE_JOB, REMOTE_UPDATE_JOB } from './contact-remote.constants.js';

/** What Google needs to mirror a Mora contact. Built when the change happens, so a later delete still knows what to remove. */
export interface RemoteContactSnapshot {
  userId: string;
  googleResourceName: string;
  name: string;
  company: string | null;
  phones: string[];
  emails: string[];
}

/**
 * Queues Google updates and deletions for contacts that exist in the user's
 * Google address book. The HTTP request returns at once; the Google call runs
 * in the background and is retried on failure.
 */
@Injectable()
export class ContactRemoteSyncService {
  constructor(@InjectQueue(CONTACT_REMOTE_QUEUE) private readonly queue: Queue) {}

  async enqueueUpdate(snapshot: RemoteContactSnapshot): Promise<void> {
    await this.queue.add(REMOTE_UPDATE_JOB, snapshot, { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: true });
  }

  async enqueueDelete(userId: string, googleResourceName: string): Promise<void> {
    await this.queue.add(REMOTE_DELETE_JOB, { userId, googleResourceName }, { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: true });
  }
}
