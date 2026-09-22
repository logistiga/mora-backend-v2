import { Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface.js';
import { EmbeddingService } from './embedding.service.js';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider.js';

@Module({
  providers: [
    OpenAiEmbeddingProvider,
    { provide: EMBEDDING_PROVIDER, useExisting: OpenAiEmbeddingProvider },
    EmbeddingService,
  ],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
