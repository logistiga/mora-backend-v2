import type { LlmToolCallRequest } from '../llm/llm-provider.interface.js';
import type { RouterDecisionResult } from '../router/router.types.js';

export interface AgentUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AgentResponse {
  content: string;
  metadata: Record<string, unknown>;
  /**
   * Phase D: when the LLM proposed calling a tool instead of (or alongside)
   * a plain reply. The agent itself never executes anything — deciding
   * whether/how to run these is the orchestrator's job (via ToolExecutor),
   * since only the orchestrator has the full picture (route, conversation,
   * confirmation policy). See MoraOrchestratorService.
   */
  toolCalls?: LlmToolCallRequest[];
}

/**
 * Agents no longer receive a pre-fetched history array: they build their own
 * context via ContextBuilderService (Phase C), which strictly scopes every
 * data source (messages, memories, profile facts, summary) to
 * (userId, scope, space) — this is the enforcement point for
 * "Personal never sees Professional and vice versa".
 */
export interface AgentInput {
  user: AgentUser;
  message: string;
  conversationId: string;
  routerDecision: RouterDecisionResult;
  channel?: 'text' | 'voice' | 'vision';
  recentInterruption?: boolean;
  externalContextNotes?: string[];
}
