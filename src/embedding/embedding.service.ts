import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiModelSelectorService } from '../ai-providers/ai-model-selector.service.js';
import { EmbeddingAdapterRegistry } from '../ai-providers/adapters/embedding-adapter-registry.service.js';
import { LlmCallLogger } from '../ai-providers/llm-call-logger.service.js';
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

export interface EmbeddingSelectionContext {
  userId?: string;
  scope?: string;
  space?: string;
}

/**
 * Single entry point callers use instead of talking to a provider directly.
 * Never throws — a disabled/misconfigured/failing provider always yields a
 * structured "no embedding" outcome so the memory pipeline can fall back to
 * text search instead of breaking (see AGENTS §5 / §7).
 *
 * Phase C.5 selection order (mirrors LlmService — see docs/ARCHITECTURE.md):
 *   1. If a `userId` is given in `context`, look up an active `AiProvider`
 *      row of kind "embedding" (AiModelSelectorService).
 *   2. Otherwise, or if none exists, fall back to the legacy env-configured
 *      provider (`MORA_EMBEDDING_*`), kept for backward compatibility.
 *   3. If neither is configured, return `enabled: false` — never throws.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly envProvider: EmbeddingProviderInterface,
    private readonly modelSelector: AiModelSelectorService,
    private readonly embeddingAdapters: EmbeddingAdapterRegistry,
    private readonly callLogger: LlmCallLogger,
  ) {}

  isEnabled(): boolean {
    return this.envProvider.isConfigured();
  }

  async embed(text: string, context: EmbeddingSelectionContext = {}): Promise<EmbeddingOutcome> {
    if (context.userId) {
      const dbOutcome = await this.embedWithDbProvider(text, context);
      if (dbOutcome) return dbOutcome;
    }

    return this.embedWithEnvProvider(text);
  }

  private async embedWithDbProvider(
    text: string,
    context: EmbeddingSelectionContext,
  ): Promise<EmbeddingOutcome | null> {
    const connection = await this.modelSelector.selectProvider(context.userId!, {
      kind: 'embedding',
      scope: context.scope,
      space: context.space,
    });
    if (!connection) return null;

    const adapter = this.embeddingAdapters.getAdapter(connection.provider);
    if (!adapter) {
      this.logger.warn(`No embedding adapter registered for provider "${connection.provider}"`);
      return null;
    }

    const start = Date.now();
    try {
      const result = await adapter.embed(connection, text);
      await this.callLogger.log({
        userId: context.userId,
        providerId: connection.providerRowId,
        kind: 'embedding',
        model: result.model,
        scope: context.scope,
        space: context.space,
        latencyMs: Date.now() - start,
        status: 'success',
      });
      this.logger.debug(
        `Embedding computed in ${Date.now() - start}ms via AiProvider (provider=${connection.provider}, model=${result.model}, dims=${result.dimensions})`,
      );
      return {
        enabled: true,
        embedding: result.embedding,
        model: result.model,
        dimensions: result.dimensions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Embedding provider (DB) failed, falling back to no embedding: ${message}`);
      await this.callLogger.log({
        userId: context.userId,
        providerId: connection.providerRowId,
        kind: 'embedding',
        model: connection.model,
        scope: context.scope,
        space: context.space,
        latencyMs: Date.now() - start,
        status: 'error',
        errorCode: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      return { enabled: true, embedding: null, model: null, dimensions: null, error: message };
    }
  }

  private async embedWithEnvProvider(text: string): Promise<EmbeddingOutcome> {
    if (!this.envProvider.isConfigured()) {
      return { enabled: false, embedding: null, model: null, dimensions: null };
    }

    try {
      const start = Date.now();
      const result = await this.envProvider.embed(text);
      this.logger.debug(
        `Embedding computed in ${Date.now() - start}ms (provider=${this.envProvider.name}, model=${result.model}, dims=${result.dimensions})`,
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
