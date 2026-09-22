# Frontend Types — Mora Backend v2 (Phase A + Phase B)

Conceptual TypeScript interfaces matching the **actual** JSON shapes returned by the API
today (see [`API_CONTRACT.md`](API_CONTRACT.md) for full endpoint details). Copy/adapt these
into the frontend codebase — this file is documentation, not shipped code.

```typescript
// ---- Shared enums / unions --------------------------------------------------

type UserRole = 'USER' | 'ADMIN';

type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM'; // SYSTEM never produced in Phase B

type MoraRoute = 'direct' | 'personal' | 'professional' | 'hybrid';
type MoraScope = 'direct' | 'personal' | 'professional' | 'hybrid';
type ProfessionalSpace = 'general' | 'logistiga' | 'piston' | 'code';
type MoraSpace = 'direct' | 'personal' | 'hybrid' | ProfessionalSpace;
type MoraComplexity = 'low' | 'medium' | 'high';
type MoraSecurityLevel = 'low' | 'medium' | 'high';

// ---- Auth (Phase A) ----------------------------------------------------------

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface User {
  id: string; // uuid
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string; // ISO datetime
  // passwordHash is NEVER present in API responses
}

// ---- Health --------------------------------------------------------------

interface HealthCheckEntry {
  status: 'up' | 'down';
  message?: string; // present only when status === 'down'
}

interface HealthResponse {
  status: 'ok' | 'error';
  info: Record<string, HealthCheckEntry>; // e.g. { postgres: {...}, redis: {...} }
  error: Record<string, HealthCheckEntry>;
  details: Record<string, HealthCheckEntry>;
}

// ---- Conversations & Messages (Phase B) -----------------------------------

interface Conversation {
  id: string; // uuid
  userId: string; // uuid
  title: string | null; // always null in Phase B (no auto-titling yet)
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string; // uuid
  conversationId: string; // uuid
  role: MessageRole;
  content: string;
  scope: MoraScope;
  space: MoraSpace;
  metadata: Record<string, unknown>; // free-form, e.g. { agent: 'personal', llmConfigured: false }
  createdAt: string;
}

interface ConversationWithMessages extends Conversation {
  messages: Message[]; // oldest → newest
}

// ---- Router decisions (Phase B) -------------------------------------------

interface RouterDecision {
  id: string; // uuid
  conversationId: string; // uuid
  messageId: string | null; // uuid of the user message this decision was made for
  route: MoraRoute;
  scope: MoraScope;
  space: MoraSpace;
  intent: string; // e.g. 'greeting' | 'question' | 'task' | 'information' | 'unknown'
  complexity: MoraComplexity;
  securityLevel: MoraSecurityLevel;
  confidence: number; // 0..1
  metadata: Record<string, unknown>; // e.g. { method: 'rules' | 'llm-fallback' | 'default-fallback' }
  createdAt: string;
}

// ---- POST /api/v1/messages response ---------------------------------------

interface MessageResponse {
  conversationId: string; // uuid
  messageId: string; // uuid — Mora's reply, not the user's message
  response: string; // Mora's reply text (may be an "LLM not configured" placeholder)
  route: MoraRoute;
  scope: MoraScope;
  space: MoraSpace;
  confidence: number; // 0..1
}

// ---- Error shape (every endpoint) ------------------------------------------

interface ApiError {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
}
```

## Notes for the frontend implementer

- Dates are ISO 8601 strings (`Date`-parseable), not Unix timestamps.
- `metadata` fields are intentionally loose (`Record<string, unknown>`) — treat their
  contents as debug/optional-display info, never rely on a specific key being present in
  production UI logic beyond what's documented in `API_CONTRACT.md`.
- There is no `WebSocket`/`SSE` response type yet — Phase B is REST-only, request/response.
  Real-time transport is planned but not implemented (see `docs/ROADMAP.md`).
