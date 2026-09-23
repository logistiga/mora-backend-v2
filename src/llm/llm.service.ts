import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiModelSelectorService } from '../ai-providers/ai-model-selector.service.js';
import { ChatAdapterRegistry } from '../ai-providers/adapters/chat-adapter-registry.service.js';
import { LlmCallLogger } from '../ai-providers/llm-call-logger.service.js';
import type {
  LlmCompletionRequest,
  LlmProviderInterface,
  LlmToolCallRequest,
} from './llm-provider.interface.js';
import { LLM_PROVIDER } from './llm-provider.interface.js';

export interface LlmResponse {
  configured: boolean;
  content: string;
  provider: string;
  model: string | null;
  /**
   * Only ever populated when the request included `tools` AND the call went
   * through a DB AiProvider (Phase D tool-calling requires a real DB
   * provider, same as embeddings/memory in Phase C — the legacy env
   * fallback never forwards `tools`, so it can never propose a tool call).
   */
  toolCalls?: LlmToolCallRequest[];
}

export interface LlmSelectionContext {
  userId?: string;
  route?: string;
  scope?: string;
  space?: string;
}

const NOT_CONFIGURED_MESSAGE =
  "Configuration LLM manquante : aucun provider n'est configuré (OPENAI_API_KEY absent, et aucun " +
  "AiProvider chat actif en base). Cette réponse est un espace réservé — configurez un provider " +
  'pour obtenir une vraie réponse.';

/**
 * Single entry point agents call instead of talking to a provider directly.
 * Never throws for a missing/misconfigured provider — always returns a
 * structured response so the app keeps running (see AGENTS §4).
 *
 * Phase C.5 selection order (see docs/ARCHITECTURE.md):
 *   1. If a `userId` is given in `context`, look up an active `AiProvider`
 *      row of kind "chat" (AiModelSelectorService — scope/space aware).
 *   2. Otherwise, or if none exists, fall back to the legacy env-configured
 *      provider (`OPENAI_API_KEY` etc.) kept for backward compatibility.
 *   3. If neither is configured, return the "not configured" placeholder —
 *      never throws.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly envProvider: LlmProviderInterface,
    private readonly modelSelector: AiModelSelectorService,
    private readonly chatAdapters: ChatAdapterRegistry,
    private readonly callLogger: LlmCallLogger,
  ) {}

  /** True if EITHER the env fallback OR (when a userId is later given) a DB provider could serve a request. */
  isConfigured(): boolean {
    return this.envProvider.isConfigured();
  }

  async complete(request: LlmCompletionRequest, context: LlmSelectionContext = {}): Promise<LlmResponse> {
    if (context.userId) {
      const dbResponse = await this.completeWithDbProvider(request, context);
      if (dbResponse) return dbResponse;
    }

    return this.completeWithEnvProvider(request);
  }

  private async completeWithDbProvider(
    request: LlmCompletionRequest,
    context: LlmSelectionContext,
  ): Promise<LlmResponse | null> {
    const connection = await this.modelSelector.selectProvider(context.userId!, {
      kind: 'chat',
      scope: context.scope,
      space: context.space,
      route: context.route,
    });
    if (!connection) {
      return null; // no DB provider configured — caller falls back to env
    }

    const adapter = this.chatAdapters.getAdapter(connection.provider);
    if (!adapter) {
      this.logger.warn(`No chat adapter registered for provider "${connection.provider}"`);
      return null;
    }

    const start = Date.now();
    try {
      const result = await adapter.complete(connection, request);
      await this.callLogger.log({
        userId: context.userId,
        providerId: connection.providerRowId,
        kind: 'chat',
        model: connection.model,
        route: context.route,
        scope: context.scope,
        space: context.space,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        latencyMs: Date.now() - start,
        status: 'success',
      });
      return {
        configured: true,
        content: result.content,
        provider: connection.provider,
        model: result.model,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      this.logger.error(
        `Chat completion failed via AiProvider ${connection.providerRowId}`,
        error instanceof Error ? error.stack : error,
      );
      await this.callLogger.log({
        userId: context.userId,
        providerId: connection.providerRowId,
        kind: 'chat',
        model: connection.model,
        route: context.route,
        scope: context.scope,
        space: context.space,
        latencyMs: Date.now() - start,
        status: 'error',
        errorCode: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      return {
        configured: true,
        content: 'Le provider LLM est configuré mais la requête a échoué. Réessayez plus tard.',
        provider: connection.provider,
        model: null,
      };
    }
  }

  private async completeWithEnvProvider(request: LlmCompletionRequest): Promise<LlmResponse> {
    if (!this.envProvider.isConfigured()) {
      return {
        configured: false,
        content: NOT_CONFIGURED_MESSAGE,
        provider: this.envProvider.name,
        model: null,
      };
    }

    try {
      const result = await this.envProvider.complete(request);
      return { configured: true, ...result };
    } catch (error) {
      this.logger.error('LLM completion failed', error instanceof Error ? error.stack : error);
      return {
        configured: true,
        content: 'Le provider LLM est configuré mais la requête a échoué. Réessayez plus tard.',
        provider: this.envProvider.name,
        model: null,
      };
    }
  }
}
