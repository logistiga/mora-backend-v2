import type { LlmMessage } from '../llm/llm-provider.interface.js';
import type { RouterDecisionResult } from '../router/router.types.js';

export interface AgentUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Prior turns of THIS conversation, already filtered to the scope the agent
 * is allowed to see (see ConversationsService.getScopedHistory) — an agent
 * never receives another scope's messages.
 */
export interface AgentContext {
  history: LlmMessage[];
}

export interface AgentResponse {
  content: string;
  metadata: Record<string, unknown>;
}

export interface AgentInput {
  user: AgentUser;
  message: string;
  routerDecision: RouterDecisionResult;
  context: AgentContext;
}
