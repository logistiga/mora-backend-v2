import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

@Module({
  providers: [
    OpenAiCompatibleProvider,
    { provide: LLM_PROVIDER, useExisting: OpenAiCompatibleProvider },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
