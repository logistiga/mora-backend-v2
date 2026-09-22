import { forwardRef, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ConversationSummariesController } from './conversation-summaries.controller.js';
import { ConversationSummaryService } from './conversation-summary.service.js';
import { EntitiesController } from './entities.controller.js';
import { EntitiesService } from './entities.service.js';
import { MemoryController } from './memory.controller.js';
import { MemoryEmbeddingRepository } from './memory-embedding.repository.js';
import { MemoryExtractionService } from './memory-extraction.service.js';
import { MemoryRetrievalService } from './memory-retrieval.service.js';
import { MemoryService } from './memory.service.js';
import { ProfileFactsController } from './profile-facts.controller.js';
import { ProfileFactsService } from './profile-facts.service.js';
import { MemoryQueueModule } from './queue/memory-queue.module.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    LlmModule,
    EmbeddingModule,
    // Cycle: MemoryModule needs MemoryQueueService (to enqueue), the queue's
    // processors need MemoryService/MemoryExtractionService/
    // ConversationSummaryService (to do the work) — forwardRef on both sides.
    forwardRef(() => MemoryQueueModule),
  ],
  controllers: [
    MemoryController,
    ProfileFactsController,
    EntitiesController,
    ConversationSummariesController,
  ],
  providers: [
    MemoryService,
    MemoryRetrievalService,
    MemoryExtractionService,
    ConversationSummaryService,
    ProfileFactsService,
    EntitiesService,
    MemoryEmbeddingRepository,
  ],
  exports: [
    MemoryService,
    MemoryRetrievalService,
    MemoryExtractionService,
    ConversationSummaryService,
    ProfileFactsService,
    EntitiesService,
    MemoryEmbeddingRepository,
  ],
})
export class MemoryModule {}
