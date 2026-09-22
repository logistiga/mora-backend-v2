import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Queue, QueueEvents } from 'bullmq';
import {
  HEALTHCHECK_JOB,
  HEALTHCHECK_QUEUE,
  HEALTHCHECK_QUEUE_EVENTS,
} from './queue.constants.js';

@Injectable()
export class QueueService implements OnModuleDestroy {
  constructor(
    @InjectQueue(HEALTHCHECK_QUEUE) private readonly healthcheckQueue: Queue,
    @Inject(HEALTHCHECK_QUEUE_EVENTS) private readonly queueEvents: QueueEvents,
  ) {}

  /** Enqueues a ping job and waits for it to complete; used by the health endpoint. */
  async pingQueue(timeoutMs = 5000): Promise<boolean> {
    const job = await this.healthcheckQueue.add(HEALTHCHECK_JOB, {
      pingedAt: new Date().toISOString(),
    });
    const result = await job.waitUntilFinished(this.queueEvents, timeoutMs);
    return Boolean(result?.pong);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents.close();
  }
}
