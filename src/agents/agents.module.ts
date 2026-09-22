import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PersonalAgentService } from './personal-agent.service.js';
import { ProfessionalAgentService } from './professional-agent.service.js';

@Module({
  imports: [LlmModule, ContextModule],
  providers: [PersonalAgentService, ProfessionalAgentService],
  exports: [PersonalAgentService, ProfessionalAgentService],
})
export class AgentsModule {}
