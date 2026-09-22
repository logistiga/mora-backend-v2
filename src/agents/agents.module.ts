import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { PersonalAgentService } from './personal-agent.service.js';
import { ProfessionalAgentService } from './professional-agent.service.js';

@Module({
  imports: [LlmModule],
  providers: [PersonalAgentService, ProfessionalAgentService],
  exports: [PersonalAgentService, ProfessionalAgentService],
})
export class AgentsModule {}
