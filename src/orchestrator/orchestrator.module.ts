import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { MemoryQueueModule } from '../memory/queue/memory-queue.module.js';
import { RouterModule } from '../router/router.module.js';
import { MoraOrchestratorService } from './mora-orchestrator.service.js';

@Module({
  imports: [RouterModule, AgentsModule, ConversationsModule, AuditModule, MemoryModule, MemoryQueueModule],
  providers: [MoraOrchestratorService],
  exports: [MoraOrchestratorService],
})
export class OrchestratorModule {}
