import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ContextBuilderService } from './context-builder.service.js';

@Module({
  imports: [ConversationsModule, MemoryModule, DocumentsModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextModule {}
