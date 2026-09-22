import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ContextBuilderService } from './context-builder.service.js';

@Module({
  imports: [ConversationsModule, MemoryModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextModule {}
