import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DocumentIntakePipelineService } from '../../document-intake-pipeline.service.js';
import { DOCUMENT_PROCESSING_QUEUE, type DocumentProcessingJobData } from '../document-queue.constants.js';

@Processor(DOCUMENT_PROCESSING_QUEUE)
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(private readonly pipeline: DocumentIntakePipelineService) {
    super();
  }

  async process(job: Job<DocumentProcessingJobData>): Promise<void> {
    this.logger.debug(
      `Processing document ${job.data.documentId} (requestId=${job.data.requestId ?? 'n/a'}, jobId=${job.id ?? 'n/a'})`,
    );
    await this.pipeline.process(job.data.documentId, job.data.userId);
  }
}
