export const MEMORY_EMBEDDING_QUEUE = 'memory-embedding';
export const MEMORY_EXTRACTION_QUEUE = 'memory-extraction';
export const CONVERSATION_SUMMARY_QUEUE = 'conversation-summary';

export const MEMORY_EMBEDDING_JOB = 'embed-memory';
export const MEMORY_EXTRACTION_JOB = 'extract-memories';
export const CONVERSATION_SUMMARY_JOB = 'summarize-conversation';

/** Applied to every Phase C queue: a provider outage must never spam-retry forever. */
export const MEMORY_JOB_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export interface MemoryEmbeddingJobData {
  memoryId: string;
  userId: string;
  requestId?: string;
}

export interface MemoryExtractionJobData {
  requestId?: string;
  userId: string;
  conversationId: string;
  scope: 'personal' | 'professional';
  space: string;
  sourceMessageId: string;
  userMessage: string;
  assistantResponse: string;
}

export interface ConversationSummaryJobData {
  requestId?: string;
  conversationId: string;
  userId: string;
  scope: string;
  space: string;
}
