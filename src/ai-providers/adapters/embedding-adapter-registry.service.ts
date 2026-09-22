import { Injectable } from '@nestjs/common';
import type { EmbeddingProviderAdapter } from './embedding-adapter.interface.js';
import { OpenAiCompatibleEmbeddingAdapter } from './openai-compatible-embedding.adapter.js';

@Injectable()
export class EmbeddingAdapterRegistry {
  private readonly adapters: EmbeddingProviderAdapter[];

  constructor(openAiCompatible: OpenAiCompatibleEmbeddingAdapter) {
    this.adapters = [openAiCompatible];
  }

  getAdapter(provider: string): EmbeddingProviderAdapter | null {
    return this.adapters.find((adapter) => adapter.supportedProviders.includes(provider)) ?? null;
  }
}
