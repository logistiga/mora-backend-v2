export const DOCUMENT_PROCESSING_QUEUE = 'document-processing';
export const DOCUMENT_PROCESSING_JOB = 'process-document';

export const DOCUMENT_JOB_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export interface DocumentProcessingJobData {
  documentId: string;
  userId: string;
}
