import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { EmbeddingModule } from '../../embedding/embedding.module.js';
import { MemoryModule } from '../memory.module.js';
import {
  CONVERSATION_SUMMARY_QUEUE,
  MEMORY_EMBEDDING_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
} from './memory-queue.constants.js';
import { ConversationSummaryProcessor } from './processors/conversation-summary.processor.js';
import { MemoryEmbeddingProcessor } from './processors/memory-embedding.processor.js';
import { MemoryExtractionProcessor } from './processors/memory-extraction.processor.js';
import { MemoryQueueService } from './memory-queue.service.js';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: MEMORY_EMBEDDING_QUEUE },
      { name: MEMORY_EXTRACTION_QUEUE },
      { name: CONVERSATION_SUMMARY_QUEUE },
    ),
    EmbeddingModule,
    // MemoryModule -> MemoryQueueModule (to enqueue) and MemoryQueueModule ->
    // MemoryModule (processors need MemoryService/MemoryExtractionService/
    // ConversationSummaryService) form a cycle; forwardRef breaks it.
    forwardRef(() => MemoryModule),
  ],
  providers: [
    MemoryQueueService,
    MemoryEmbeddingProcessor,
    MemoryExtractionProcessor,
    ConversationSummaryProcessor,
  ],
  exports: [MemoryQueueService],
})
export class MemoryQueueModule {}
