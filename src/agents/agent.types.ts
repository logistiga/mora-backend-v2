import type { RouterDecisionResult } from '../router/router.types.js';

export interface AgentUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AgentResponse {
  content: string;
  metadata: Record<string, unknown>;
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
}
