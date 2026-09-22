/**
 * `kind` and `provider` are validated as non-empty strings, not closed enums
 * — new providers/usage kinds must never require a migration (AGENTS §2).
 * These lists exist only as documentation/UI hints, not hard constraints.
 */
export const KNOWN_PROVIDER_KINDS = [
  'chat',
  'embedding',
  'vision',
  'stt',
  'tts',
  'image',
  'avatar',
] as const;
export type ProviderKind = (typeof KNOWN_PROVIDER_KINDS)[number];

export const KNOWN_PROVIDERS = [
  'openai',
  'anthropic',
  'groq',
  'deepseek',
  'gemini',
  'mistral',
  'openrouter',
  'ollama',
  'custom_openai_compatible',
] as const;

export interface ProviderCapabilities {
  chat?: boolean;
  tools?: boolean;
  streaming?: boolean;
  vision?: boolean;
  embeddings?: boolean;
  jsonMode?: boolean;
  dimensions?: number; // for embedding providers, when known ahead of a real call
  [key: string]: unknown; // forward-compatible: unknown future capability flags pass through
}

export interface ProviderSettings {
  maxTokens?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  [key: string]: unknown;
}

/** Resolved connection details for one call — never persisted, never logged whole. */
export interface ResolvedProviderConnection {
  providerRowId: string;
  provider: string;
  kind: string;
  model: string;
  baseUrl?: string;
  apiKey?: string; // decrypted, in-memory only, for the duration of one call
  capabilities: ProviderCapabilities;
  settings: ProviderSettings;
}

export interface SelectProviderParams {
  kind: string;
  scope?: string;
  space?: string;
}

/** Public-safe view of an AiProvider row — the API never returns key material. */
export interface AiProviderPublicView {
  id: string;
  name: string;
  provider: string;
  kind: string;
  baseUrl: string | null;
  model: string;
  hasKey: boolean;
  keyHint: string | null;
  isActive: boolean;
  isDefault: boolean;
  scope: string | null;
  space: string | null;
  capabilities: ProviderCapabilities | null;
  settings: ProviderSettings | null;
  priority: number;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
