import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RequestContextService } from '../../common/http/request-context.service.js';
import {
  DOCUMENT_PROCESSING_JOB,
  DOCUMENT_PROCESSING_QUEUE,
  DOCUMENT_JOB_DEFAULT_OPTIONS,
  type DocumentProcessingJobData,
} from './document-queue.constants.js';

@Injectable()
export class DocumentQueueService {
  private readonly logger = new Logger(DocumentQueueService.name);

  constructor(
    @InjectQueue(DOCUMENT_PROCESSING_QUEUE) private readonly queue: Queue,
    private readonly requestContext: RequestContextService,
  ) {}

  async enqueueProcessing(data: DocumentProcessingJobData): Promise<void> {
    const requestId = data.requestId ?? this.requestContext.getRequestId();
    // jobId = documentId: idempotent scheduling, same guard reminders use —
    // a duplicated enqueue (e.g. a retried upload call) can never schedule
    // two processing jobs for the same document (AGENTS Phase E §5).
    await this.queue.add(
      DOCUMENT_PROCESSING_JOB,
      { ...data, requestId },
      { ...DOCUMENT_JOB_DEFAULT_OPTIONS, jobId: data.documentId },
    );
    this.logger.debug(`Queued processing for document ${data.documentId} (requestId=${requestId ?? 'n/a'})`);
  }
}
