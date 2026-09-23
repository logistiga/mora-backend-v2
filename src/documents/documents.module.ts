import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { DocumentChunkEmbeddingRepository } from './document-chunk-embedding.repository.js';
import { DocumentClassificationService } from './document-classification.service.js';
import { DocumentIntakePipelineService } from './document-intake-pipeline.service.js';
import { DocumentRetrievalService } from './document-retrieval.service.js';
import { DocumentTableQueryService } from './document-table-query.service.js';
import { DocumentService } from './document.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentChunkerService } from './extraction/document-chunker.service.js';
import { DocumentExtractionService } from './extraction/document-extraction.service.js';
import { DOCUMENT_PROCESSING_QUEUE } from './queue/document-queue.constants.js';
import { DocumentQueueService } from './queue/document-queue.service.js';
import { DocumentProcessingProcessor } from './queue/processors/document-processing.processor.js';
import { LocalDocumentStorageProvider } from './storage/local-document-storage.provider.js';
import { DOCUMENT_STORAGE } from './storage/document-storage.token.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: DOCUMENT_PROCESSING_QUEUE }),
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    LlmModule,
    EmbeddingModule,
    MemoryModule,
    AuditModule,
  ],
  controllers: [DocumentsController],
  providers: [
    { provide: DOCUMENT_STORAGE, useClass: LocalDocumentStorageProvider },
    DocumentExtractionService,
    DocumentChunkerService,
    DocumentClassificationService,
    DocumentChunkEmbeddingRepository,
    DocumentIntakePipelineService,
    DocumentQueueService,
    DocumentProcessingProcessor,
    DocumentService,
    DocumentRetrievalService,
    DocumentTableQueryService,
  ],
  exports: [DocumentService, DocumentChunkEmbeddingRepository, DOCUMENT_STORAGE, DocumentRetrievalService, DocumentTableQueryService],
})
export class DocumentsModule {}
