export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Only for role: 'tool' — which provider tool-call this is the result of. */
  toolCallId?: string;
  name?: string;
}

/**
 * Provider-neutral function/tool-calling schema (Phase D, AGENTS §19). Each
 * adapter translates this into its own wire format (e.g. OpenAI's
 * `{type:'function', function:{name, description, parameters}}`) — callers
 * (PersonalAgentService/ProfessionalAgentService/orchestrator) never see the
 * provider-specific shape.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/** Normalized provider tool-call, independent of which provider proposed it. */
export interface LlmToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  providerCallId: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: LlmToolDefinition[];
}

export interface LlmCompletionResult {
  content: string;
  provider: string;
  model: string | null;
  toolCalls?: LlmToolCallRequest[];
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
