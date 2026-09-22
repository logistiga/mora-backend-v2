import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderInterface,
} from './embedding-provider.interface.js';

export interface EmbeddingOutcome {
  enabled: boolean;
  embedding: number[] | null;
  model: string | null;
  dimensions: number | null;
  error?: string;
}

/**
 * Single entry point callers use instead of talking to a provider directly.
 * Never throws — a disabled/misconfigured/failing provider always yields a
 * structured "no embedding" outcome so the memory pipeline can fall back to
 * text search instead of breaking (see AGENTS §5 / §7).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(@Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProviderInterface) {}

  isEnabled(): boolean {
    return this.provider.isConfigured();
  }

  async embed(text: string): Promise<EmbeddingOutcome> {
    if (!this.provider.isConfigured()) {
      return { enabled: false, embedding: null, model: null, dimensions: null };
    }

    try {
      const start = Date.now();
      const result = await this.provider.embed(text);
      this.logger.debug(
        `Embedding computed in ${Date.now() - start}ms (provider=${this.provider.name}, model=${result.model}, dims=${result.dimensions})`,
      );
      return {
        enabled: true,
        embedding: result.embedding,
        model: result.model,
        dimensions: result.dimensions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Embedding provider failed, falling back to no embedding: ${message}`);
      return { enabled: true, embedding: null, model: null, dimensions: null, error: message };
    }
  }
}
