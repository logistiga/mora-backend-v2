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

  async process(job: Job<MemoryExtractionJobData>): Promise<{ committed: number; essentialCommitted: number }> {
    const { userId, scope, space, sourceMessageId, userMessage, assistantResponse } = job.data;
    this.logger.debug(
      `Processing memory extraction ${sourceMessageId} (requestId=${job.data.requestId ?? 'n/a'}, jobId=${job.id ?? 'n/a'})`,
    );

    const { memories, essentialFacts } = await this.extractionService.proposeCandidates(userMessage, assistantResponse, {
      userId,
      scope,
      space,
    });

    if (memories.length > 0) {
      await this.extractionService.commitCandidates({
        userId,
        scope,
        space,
        sourceMessageId,
        candidates: memories,
      });
    }

    if (essentialFacts.length > 0) {
      await this.extractionService.commitEssentialFacts({
        userId,
        sourceMessageId,
        candidates: essentialFacts,
      });
    }

    this.logger.debug(
      `Committed ${memories.length} memory candidate(s) and ${essentialFacts.length} essential fact(s) from message ${sourceMessageId}`,
    );
    return { committed: memories.length, essentialCommitted: essentialFacts.length };
  }
}
