import { Module } from '@nestjs/common';
import { TimeModule } from '../common/time/time.module.js';
import { ContextModule } from '../context/context.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { PersonalAgentService } from './personal-agent.service.js';
import { ProfessionalAgentService } from './professional-agent.service.js';

@Module({
  imports: [LlmModule, ContextModule, ToolsModule, TimeModule],
  providers: [PersonalAgentService, ProfessionalAgentService],
  exports: [PersonalAgentService, ProfessionalAgentService],
})
export class AgentsModule {}
