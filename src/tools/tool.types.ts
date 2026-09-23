/**
 * Phase D — Tools/Actions core types.
 *
 * `securityLevel`/`scope`/`space` follow the same convention as the rest of
 * the codebase (see router.types.ts, memory.types.ts): plain string unions
 * validated in the app layer, never DB enums, so adding a tool or a scope
 * never requires a migration.
 */

/**
 * N1 AUTO         — low-risk, read-only or internal: may execute immediately.
 * N2 CONFIRMATION — modifies user state but easily reversible: always needs a
 *                   pending_action + explicit approval in Phase D.
 * N3 SENSITIVE    — conceptually supported (future external actions); always
 *                   needs a pending_action + explicit approval.
 * N4 CRITICAL     — destructive/irreversible: never executed automatically,
 *                   and Phase D ships no real N4 tool at all.
 */
export const SECURITY_LEVELS = ['N1', 'N2', 'N3', 'N4'] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

export type ToolScope = 'personal' | 'professional';

/** Minimal context every tool receives — never trusts anything the LLM said about identity/authorization. */
export interface ToolContext {
  userId: string;
  conversationId?: string;
  scope: ToolScope;
  space: string;
  route: string;
  requestId?: string;
  pendingActionId?: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * A tool's `inputSchema`/`validate` pair: `jsonSchema` is what the LLM sees
 * (provider-neutral function-calling schema), `validate` is the real backend
 * authority — the fact that the LLM produced arguments never makes them
 * trusted (AGENTS Phase D §31). Each tool implements `validate` with
 * class-validator against its own DTO rather than a generic JSON-schema
 * validator, matching the rest of the codebase's DTO conventions.
 */
export interface ToolJsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: false;
}

export interface ToolValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  errors?: string[];
}

export interface MoraTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly securityLevel: SecurityLevel;
  /** Which scopes may call this tool at all (Personal cannot call a Professional-only tool and vice versa). */
  readonly allowedScopes: readonly ToolScope[];
  readonly requiresConfirmation: boolean;
  readonly jsonSchema: ToolJsonSchema;

  validate(input: unknown): ToolValidationResult<TInput>;
  execute(context: ToolContext, input: TInput): Promise<ToolResult<TOutput>>;
}

// Note: the normalized provider tool-call type is `LlmToolCallRequest`,
// defined in llm/llm-provider.interface.ts (the provider-neutral LLM
// abstraction layer, AGENTS Phase D §19) — not duplicated here.
