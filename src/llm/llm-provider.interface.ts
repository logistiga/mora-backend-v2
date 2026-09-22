export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletionResult {
  content: string;
  provider: string;
  model: string | null;
}

/**
 * Contract every LLM provider must implement. Phase B ships one
 * implementation (OpenAI-compatible HTTP API); more providers (Anthropic,
 * local models, ...) can be added later without touching LlmService callers.
 */
export interface LlmProviderInterface {
  readonly name: string;

  /** Whether this provider has everything it needs (API key, etc.) from env. */
  isConfigured(): boolean;

  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
