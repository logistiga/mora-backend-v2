import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service.js';
import { EmbeddingService } from '../../../embedding/embedding.service.js';
import { MemoryEmbeddingRepository } from '../../memory-embedding.repository.js';
import { MEMORY_EMBEDDING_QUEUE, type MemoryEmbeddingJobData } from '../memory-queue.constants.js';

@Processor(MEMORY_EMBEDDING_QUEUE)
export class MemoryEmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryEmbeddingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingRepository: MemoryEmbeddingRepository,
  ) {
    super();
  }

  async process(job: Job<MemoryEmbeddingJobData>): Promise<{ embedded: boolean; reason?: string }> {
    const { memoryId, userId } = job.data;

    if (!this.embeddingService.isEnabled()) {
      this.logger.debug(`Skipping embedding for memory ${memoryId}: no embedding provider configured`);
      return { embedded: false, reason: 'not_configured' };
    }

    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory || memory.userId !== userId) {
      this.logger.warn(`Embedding job for missing/foreign memory ${memoryId}, skipping`);
      return { embedded: false, reason: 'memory_not_found' };
    }

    const outcome = await this.embeddingService.embed(memory.content);
    if (!outcome.embedding || !outcome.dimensions || !outcome.model) {
      this.logger.warn(`Embedding provider failed for memory ${memoryId}: ${outcome.error ?? 'unknown error'}`);
      return { embedded: false, reason: outcome.error ?? 'provider_error' };
    }

    await this.embeddingRepository.setEmbedding({
      memoryId,
      userId,
      embedding: outcome.embedding,
      model: outcome.model,
      dimensions: outcome.dimensions,
    });

    this.logger.debug(`Embedded memory ${memoryId} (model=${outcome.model}, dims=${outcome.dimensions})`);
    return { embedded: true };
  }
}
