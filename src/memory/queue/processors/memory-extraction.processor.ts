import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MemoryExtractionService } from '../../memory-extraction.service.js';
import { MEMORY_EXTRACTION_QUEUE, type MemoryExtractionJobData } from '../memory-queue.constants.js';

@Processor(MEMORY_EXTRACTION_QUEUE)
export class MemoryExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryExtractionProcessor.name);

  constructor(private readonly extractionService: MemoryExtractionService) {
    super();
  }

  async process(job: Job<MemoryExtractionJobData>): Promise<{ committed: number }> {
    const { userId, scope, space, sourceMessageId, userMessage, assistantResponse } = job.data;

    const candidates = await this.extractionService.proposeCandidates(userMessage, assistantResponse, {
      userId,
      scope,
      space,
    });
    if (candidates.length === 0) {
      return { committed: 0 };
    }

    await this.extractionService.commitCandidates({
      userId,
      scope,
      space,
      sourceMessageId,
      candidates,
    });

    this.logger.debug(`Committed ${candidates.length} memory candidate(s) from message ${sourceMessageId}`);
    return { committed: candidates.length };
  }
}
