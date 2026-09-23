# Frontend Types — Mora Backend v2 (Phase A + Phase B + Phase C + Phase C.5 + Phase D + Phase E)

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
  action?: ConfirmationRequiredAction; // Phase D — see below; absent on every pre-Phase-D response
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

// ---- Tools & Actions (Phase D) ----------------------------------------------

type SecurityLevel = 'N1' | 'N2' | 'N3' | 'N4';
// N1 auto (executes immediately) | N2 confirmation (always pending_action) |
// N3 sensitive (reserved, ships no tool in Phase D) | N4 critical (never executed).

type ToolScope = 'personal' | 'professional';

interface ToolDiscoveryView {
  name: string;
  description: string;
  securityLevel: SecurityLevel;
  requiresConfirmation: boolean;
  allowedScopes: ToolScope[];
}

interface ConfirmationRequiredAction {
  type: 'confirmation_required';
  pendingActionId: string; // uuid
  tool: string; // e.g. "create_task", "create_reminder"
  securityLevel: SecurityLevel;
  summary: string; // human-readable, safe to render directly (e.g. "Créer une tâche : \"Appeler Jean\"")
}

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
type TaskSource = 'manual' | 'tool'; // 'manual' = direct REST, 'tool' = approved LLM tool call

interface Task {
  id: string;
  userId: string;
  scope: ToolScope;
  space: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  source: TaskSource;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

type ReminderStatus = 'scheduled' | 'delivered' | 'cancelled' | 'failed';

interface Reminder {
  id: string;
  userId: string;
  scope: ToolScope;
  space: string;
  title: string;
  message: string | null;
  remindAt: string;
  status: ReminderStatus;
  source: TaskSource;
  sourceConversationId: string | null;
  bullJobId: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type PendingActionStatus =
  | 'pending' | 'approved' | 'rejected' | 'executed' | 'expired' | 'cancelled' | 'failed';

interface PendingAction {
  id: string;
  userId: string;
  conversationId: string | null;
  toolName: string;
  toolVersion: string;
  scope: ToolScope;
  space: string;
  securityLevel: SecurityLevel;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null; // populated once status is "executed"/"failed"
  status: PendingActionStatus;
  expiresAt: string | null; // 30 min after creation
  approvedAt: string | null;
  rejectedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ApproveOutcomeStatus = 'executed' | 'already_processed' | 'expired';

interface ApproveResult {
  status: ApproveOutcomeStatus;
  pendingAction: PendingAction;
  toolResultOk?: boolean; // only when status === 'executed'
}

type RejectOutcomeStatus = 'rejected' | 'already_processed';

interface RejectResult {
  status: RejectOutcomeStatus;
  pendingAction: PendingAction;
}

type NotificationStatus = 'unread' | 'read';
type NotificationType = 'reminder' | string; // 'reminder' is the only type Phase D produces

interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  metadata: Record<string, unknown>; // e.g. { reminderId, scope, space } for type: 'reminder'
  readAt: string | null;
  createdAt: string;
}

// ---- Documents & Document Intelligence (Phase E) ---------------------------

type DocumentStatus = 'uploaded' | 'queued' | 'processing' | 'ready' | 'needs_review' | 'failed' | 'archived';

interface Document {
  id: string;
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  filename: string; // internal storage filename, not user-facing
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  documentType: string | null; // AI-suggested, e.g. 'invoice' | 'contract' | 'report' | 'other'
  title: string | null;
  language: string | null;
  source: 'upload' | 'whatsapp' | 'email';
  sourceId: string | null;
  storageProvider: string; // 'local' today
  storageKey: string; // internal — never a browser-usable URL
  status: DocumentStatus;
  classificationConfidence: number | null; // 0..1
  needsReview: boolean;
  summary: string | null;
  keyPoints: unknown | null;
  checksum: string; // SHA-256, dedup key
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

interface DocumentTable {
  id: string;
  documentId: string;
  sheetName: string | null;
  tableIndex: number;
  title: string | null;
  columns: { name: string; type: string }[];
  rowCount: number;
  columnCount: number;
  createdAt: string;
}

interface DocumentDetail {
  document: Document;
  tags: string[];
  entities: Entity[]; // reuses the Phase C Entity type
  tables: DocumentTable[];
}

interface DocumentChunkCitation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  page: number | null;
  section: string | null;
  score: number;
  mode: 'semantic' | 'text';
}

// ---- Contacts (Phase E) -----------------------------------------------------

type TrustLevel = 'unknown' | 'known' | 'trusted' | 'vip' | 'restricted' | 'blocked';
type ContactIdentityType = 'whatsapp' | 'email';

interface ContactIdentity {
  id: string;
  contactId: string;
  type: ContactIdentityType;
  valueNormalized: string;
  displayValue: string;
  verified: boolean;
  createdAt: string;
}

interface Contact {
  id: string;
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  scope: 'personal' | 'professional';
  space: string;
  relationship: string | null;
  trustLevel: TrustLevel;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
  identities?: ContactIdentity[]; // present on GET /contacts/:id only
}

// ---- Calendar (Phase E) ------------------------------------------------------

type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

interface CalendarEvent {
  id: string;
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string; // explicit, never implicit — see TimeContextService
  status: CalendarEventStatus;
  recurrenceRule: string | null;
  source: 'mora' | 'google' | 'microsoft'; // only 'mora' is real in Phase E
}

interface FreeSlot {
  startsAt: string;
  endsAt: string;
}

// ---- WhatsApp (Phase E — Mora's own number) ----------------------------------

interface WhatsAppAccount {
  id: string;
  label: string;
  phoneNumber: string;
  provider: 'evolution' | 'meta_cloud';
  status: 'configured' | 'connected' | 'disconnected' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
  // NEVER present: apiKey, credentialsEncrypted, credentialsIv, credentialsAuthTag.
}

interface WhatsAppConversation {
  id: string;
  accountId: string;
  contactId: string | null;
  scope: string;
  space: string;
  lastMessageAt: string | null;
}

interface WhatsAppMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  contactId: string | null;
  timestamp: string;
  status: string | null;
  text: string | null;
}

// ---- Email (Phase E — Mora's own mailbox(es)) --------------------------------

interface EmailAccount {
  id: string;
  label: string;
  address: string;
  provider: 'imap_smtp' | 'gmail' | 'microsoft_graph';
  status: 'configured' | 'connected' | 'disconnected' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
  // NEVER present: password, credentialsEncrypted, credentialsIv, credentialsAuthTag.
}

interface EmailThread {
  id: string;
  accountId: string;
  subject: string | null;
  scope: string;
  space: string;
  contactId: string | null;
  lastMessageAt: string | null;
}

interface EmailMessage {
  id: string;
  threadId: string;
  providerMessageId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  textBody: string | null;
  htmlBodySanitized: string | null; // ALWAYS sanitized — never raw provider HTML
  direction: 'inbound' | 'outbound';
  receivedAt: string | null;
  sentAt: string | null;
  contactId: string | null;
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
- Phase D: `MessageResponse.action` is the **only** signal that a confirmation is needed —
  never infer it from `response` text (Mora's phrasing there is not a stable contract). Treat
  every REST mutation under `/tasks`, `/reminders` as immediate (no `pending_action` involved),
  and every `action` coming back from `/messages` as requiring an explicit
  `POST /pending-actions/:id/approve` or `/reject` before anything happens. The same rule
  applies to every Phase E N2 tool (`create_contact`, `calendar_create_event`,
  `whatsapp_send_message`, `email_send`, etc.).
- Phase E: `Document.storageKey`/`storageProvider` are internal — never construct a download
  URL from them client-side; there is no public file-serving endpoint yet (out of scope, see
  "Endpoints NOT yet available"). `WhatsAppAccount`/`EmailAccount` never expose credentials on
  the wire, the same discipline as `AiProvider`.
