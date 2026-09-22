import { Module } from '@nestjs/common';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { LLM_PROVIDER } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

@Module({
  imports: [AiProvidersModule],
  providers: [
    OpenAiCompatibleProvider,
    { provide: LLM_PROVIDER, useExisting: OpenAiCompatibleProvider },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
