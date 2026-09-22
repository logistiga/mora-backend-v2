import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
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
  ) {}

  async enqueueEmbedding(data: MemoryEmbeddingJobData): Promise<void> {
    await this.embeddingQueue.add(MEMORY_EMBEDDING_JOB, data, MEMORY_JOB_DEFAULT_OPTIONS);
    this.logger.debug(`Queued embedding job for memory ${data.memoryId}`);
  }

  async enqueueExtraction(data: MemoryExtractionJobData): Promise<void> {
    await this.extractionQueue.add(MEMORY_EXTRACTION_JOB, data, MEMORY_JOB_DEFAULT_OPTIONS);
    this.logger.debug(`Queued extraction job for message ${data.sourceMessageId}`);
  }

  async enqueueSummary(data: ConversationSummaryJobData): Promise<void> {
    await this.summaryQueue.add(CONVERSATION_SUMMARY_JOB, data, MEMORY_JOB_DEFAULT_OPTIONS);
    this.logger.debug(`Queued summary job for conversation ${data.conversationId}`);
  }
}
