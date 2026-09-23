import type { LlmMessage, LlmToolCallRequest, LlmToolDefinition } from '../../llm/llm-provider.interface.js';
import type { ResolvedProviderConnection } from '../ai-provider.types.js';

export interface ChatAdapterRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: LlmToolDefinition[];
}

export interface ChatAdapterResult {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  toolCalls?: LlmToolCallRequest[];
}

/**
 * Stateless adapter contract: every method takes a `ResolvedProviderConnection`
 * (already decrypted, in-memory only — see AiModelSelectorService) instead of
 * holding its own config. This is what makes adding a new provider (Anthropic,
 * Gemini, ...) never require touching PersonalAgentService/ProfessionalAgentService:
 * they only ever talk to LlmService, which picks the adapter matching
 * `connection.provider`.
 */
export interface ChatProviderAdapter {
  /** Which `AiProvider.provider` value(s) this adapter handles, e.g. 'openai', 'custom_openai_compatible'. */
  readonly supportedProviders: readonly string[];

  complete(connection: ResolvedProviderConnection, request: ChatAdapterRequest): Promise<ChatAdapterResult>;

  supportsTools(connection: ResolvedProviderConnection): boolean;
  supportsVision(connection: ResolvedProviderConnection): boolean;
  supportsJsonMode(connection: ResolvedProviderConnection): boolean;
}
