import type { ResolvedProviderConnection } from '../ai-provider.types.js';

export interface EmbeddingAdapterResult {
  embedding: number[];
  model: string;
  dimensions: number; // always measured from the real response, never assumed
}

export interface EmbeddingProviderAdapter {
  readonly supportedProviders: readonly string[];

  embed(connection: ResolvedProviderConnection, text: string): Promise<EmbeddingAdapterResult>;
}
