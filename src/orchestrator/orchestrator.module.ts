import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { RouterModule } from '../router/router.module.js';
import { MoraOrchestratorService } from './mora-orchestrator.service.js';

@Module({
  imports: [RouterModule, AgentsModule, ConversationsModule, AuditModule],
  providers: [MoraOrchestratorService],
  exports: [MoraOrchestratorService],
})
export class OrchestratorModule {}
