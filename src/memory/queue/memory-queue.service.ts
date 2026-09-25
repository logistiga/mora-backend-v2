import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RequestContextService } from '../../common/http/request-context.service.js';
import {
  CONVERSATION_SUMMARY_JOB,
  CONVERSATION_SUMMARY_QUEUE,
  MEMORY_EMBEDDING_JOB,
  MEMORY_EMBEDDING_QUEUE,
  MEMORY_EXTRACTION_JOB,
  MEMORY_EXTRACTION_QUEUE,
  MEMORY_JOB_DEFAULT_OPTIONS,
  type ConversationSummaryJobData,
  type MemoryEmbeddingJobData,
  type MemoryExtractionJobData,
} from './memory-queue.constants.js';

/**
 * Every enqueue here is fire-and-forget from the caller's perspective: the
 * main request/response path (POST /messages) never awaits a memory job, so
 * a slow or failing embedding/extraction/summary provider can never make the
 * user wait on — or break — their conversation.
 */
@Injectable()
export class MemoryQueueService {
  private readonly logger = new Logger(MemoryQueueService.name);

  constructor(
    @InjectQueue(MEMORY_EMBEDDING_QUEUE) private readonly embeddingQueue: Queue,
    @InjectQueue(MEMORY_EXTRACTION_QUEUE) private readonly extractionQueue: Queue,
    @InjectQueue(CONVERSATION_SUMMARY_QUEUE) private readonly summaryQueue: Queue,
    private readonly requestContext: RequestContextService,
  ) {}

  async enqueueEmbedding(data: MemoryEmbeddingJobData): Promise<void> {
    const requestId = data.requestId ?? this.requestContext.getRequestId();
    await this.embeddingQueue.add(
      MEMORY_EMBEDDING_JOB,
      { ...data, requestId },
      MEMORY_JOB_DEFAULT_OPTIONS,
    );
    this.logger.debug(`Queued embedding job for memory ${data.memoryId} (requestId=${requestId ?? 'n/a'})`);
  }

  async enqueueExtraction(data: MemoryExtractionJobData): Promise<void> {
    const requestId = data.requestId ?? this.requestContext.getRequestId();
    await this.extractionQueue.add(
      MEMORY_EXTRACTION_JOB,
      { ...data, requestId },
      MEMORY_JOB_DEFAULT_OPTIONS,
    );
    this.logger.debug(`Queued extraction job for message ${data.sourceMessageId} (requestId=${requestId ?? 'n/a'})`);
  }

  async enqueueSummary(data: ConversationSummaryJobData): Promise<void> {
    const requestId = data.requestId ?? this.requestContext.getRequestId();
    await this.summaryQueue.add(
      CONVERSATION_SUMMARY_JOB,
      { ...data, requestId },
      MEMORY_JOB_DEFAULT_OPTIONS,
    );
    this.logger.debug(`Queued summary job for conversation ${data.conversationId} (requestId=${requestId ?? 'n/a'})`);
  }
}
