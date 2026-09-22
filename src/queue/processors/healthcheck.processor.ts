import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { HEALTHCHECK_QUEUE } from '../queue.constants.js';

/**
 * Trivial worker used only to prove the Redis/BullMQ plumbing works end to end.
 * Real job types arrive in later phases (memory indexing, tool execution, ...).
 */
@Processor(HEALTHCHECK_QUEUE)
export class HealthcheckProcessor extends WorkerHost {
  private readonly logger = new Logger(HealthcheckProcessor.name);

  async process(job: Job<{ pingedAt: string }>): Promise<{ pong: true; pingedAt: string }> {
    this.logger.debug(`Processing healthcheck job ${job.id}`);
    return { pong: true, pingedAt: job.data.pingedAt };
  }
}
