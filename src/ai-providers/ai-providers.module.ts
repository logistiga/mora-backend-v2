import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiModelSelectorService } from './ai-model-selector.service.js';
import { AiProviderController } from './ai-provider.controller.js';
import { AiProviderService } from './ai-provider.service.js';
import { ChatAdapterRegistry } from './adapters/chat-adapter-registry.service.js';
import { EmbeddingAdapterRegistry } from './adapters/embedding-adapter-registry.service.js';
import { OpenAiCompatibleChatAdapter } from './adapters/openai-compatible-chat.adapter.js';
import { OpenAiCompatibleEmbeddingAdapter } from './adapters/openai-compatible-embedding.adapter.js';
import { LlmCallLogger } from './llm-call-logger.service.js';
import { SecretEncryptionService } from './secret-encryption.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [AiProviderController],
  providers: [
    SecretEncryptionService,
    OpenAiCompatibleChatAdapter,
    OpenAiCompatibleEmbeddingAdapter,
    ChatAdapterRegistry,
    EmbeddingAdapterRegistry,
    AiProviderService,
    AiModelSelectorService,
    LlmCallLogger,
  ],
  exports: [
    AiProviderService,
    AiModelSelectorService,
    SecretEncryptionService,
    LlmCallLogger,
    ChatAdapterRegistry,
    EmbeddingAdapterRegistry,
  ],
})
export class AiProvidersModule {}
