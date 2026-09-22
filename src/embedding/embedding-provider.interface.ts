export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

/**
 * Contract every embedding provider must implement. Phase C ships one
 * implementation (OpenAI-compatible /v1/embeddings); more providers can be
 * added later without touching EmbeddingService callers.
 */
export interface EmbeddingProviderInterface {
  readonly name: string;

  isConfigured(): boolean;

  embed(text: string): Promise<EmbeddingResult>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
