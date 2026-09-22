# Frontend Types — Mora Backend v2 (Phase A + Phase B + Phase C + Phase C.5)

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

// ---- Memory (Phase C) -------------------------------------------------------

type MemoryKind =
  | 'fact' | 'preference' | 'person' | 'company' | 'decision'
  | 'procedure' | 'event' | 'project' | 'habit';
type MemoryStatus = 'active' | 'pending' | 'archived' | 'superseded';
type MemorySource = 'manual' | 'extraction';

interface Memory {
  id: string; // uuid
  userId: string; // uuid
  scope: 'personal' | 'professional';
  space: MoraSpace; // in practice never 'direct' | 'hybrid' for a Memory
  kind: MemoryKind;
  content: string;
  importance: number; // 0..1
  confidence: number; // 0..1
  source: MemorySource;
  sourceId: string | null; // uuid of the message this was extracted from, if any
  status: MemoryStatus;
  validFrom: string;
  validUntil: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  supersededById: string | null; // uuid of the memory that replaced this one, if superseded
  embeddingModel: string | null; // null until embedded, or forever with no embedding provider
  embeddingDimensions: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  // Note: the raw embedding vector is NEVER present in API responses.
}

interface ProfileFact {
  id: string;
  userId: string;
  scope: 'personal' | 'professional';
  space: MoraSpace;
  key: string;
  value: string;
  confidence: number; // 0..1
  source: string;
  status: 'active' | 'archived' | 'superseded';
  validFrom: string;
  validUntil: string | null;
  supersededById: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type EntityType = 'person' | 'company' | 'client' | 'project' | 'place' | 'equipment' | 'object';

interface Entity {
  id: string;
  userId: string;
  scope: 'personal' | 'professional';
  space: MoraSpace;
  type: EntityType;
  name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ConversationSummary {
  id: string;
  conversationId: string;
  userId: string;
  scope: MoraScope;
  space: MoraSpace;
  summary: string;
  fromMessageId: string | null;
  toMessageId: string | null;
  messageCount: number;
  approxTokenCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- AI Providers (Phase C.5) ----------------------------------------------

type ProviderKind = 'chat' | 'embedding' | 'vision' | 'stt' | 'tts' | 'image' | 'avatar' | string;
// Common `provider` values (not a closed list — any string is accepted):
type KnownProvider =
  | 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'gemini' | 'mistral'
  | 'openrouter' | 'ollama' | 'custom_openai_compatible' | string;

interface ProviderCapabilities {
  chat?: boolean;
  tools?: boolean;
  streaming?: boolean;
  vision?: boolean;
  embeddings?: boolean;
  jsonMode?: boolean;
  dimensions?: number;
  [key: string]: unknown;
}

interface ProviderSettings {
  maxTokens?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  [key: string]: unknown;
}

interface AiProvider {
  id: string;
  name: string;
  provider: KnownProvider;
  kind: ProviderKind;
  baseUrl: string | null;
  model: string;
  hasKey: boolean;
  keyHint: string | null; // last 4 chars only — NEVER the full key
  isActive: boolean;
  isDefault: boolean;
  scope: 'personal' | 'professional' | null; // null = applies to every scope of this kind
  space: string | null; // null = applies to every space of this scope
  capabilities: ProviderCapabilities | null;
  settings: ProviderSettings | null;
  priority: number;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failure' | null;
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
  // NEVER present: apiKey, apiKeyEncrypted, apiKeyIv, apiKeyAuthTag.
}

interface TestProviderResult {
  success: boolean;
  message: string; // human-readable, sanitized — safe to render directly
}

interface AiProviderStatus {
  chatConfigured: boolean;
  embeddingConfigured: boolean;
  visionConfigured: boolean;
  sttConfigured: boolean;
  ttsConfigured: boolean;
  imageConfigured: boolean;
  avatarConfigured: boolean;
  defaults: Record<
    string, // kind
    { id: string; name: string; provider: string; model: string } | null
  >;
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
- `AiProvider` has no `apiKey` field on the wire, ever — don't add one to a local type either;
  a form component should keep a plaintext key entirely in local component state and send it
  only in the `POST`/`PATCH` request body, never store it in app state/cache alongside the rest
  of the provider object.
