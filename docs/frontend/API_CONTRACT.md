# API Contract — Mora Backend v2 (Phase A + Phase B + Phase C + Phase C.5 + Phase D + Phase E + Phase F + Phase G + Phase H)

Base URL (local dev): `http://localhost:3000/api/v1`
All request/response bodies are JSON. Auth is JWT Bearer unless stated otherwise.

**Global error shape** (from `AllExceptionsFilter`, applies to every endpoint below):
```json
{
  "statusCode": 401,
  "timestamp": "2026-09-22T13:00:00.000Z",
  "path": "/api/v1/users/me",
  "method": "GET",
  "requestId": "req_123",
  "message": "Unauthorized"
}
```
`message` can be a string or a string array (validation errors return an array, one entry
per failed field).

**Request correlation**:
- Every HTTP response now includes `X-Request-Id`.
- Error bodies also include the same `requestId`.
- The frontend should preserve/show this ID in bug reporting and debug UI instead of inventing
  its own correlation token.

**Rate limiting**: global default 100 requests / 60s per client (env-configurable); `POST
/auth/login` is stricter: 5 requests / 60s. Additional stricter endpoints:
- `POST /messages`: 30 / 60s
- `POST /documents`: 10 / 60s
- `POST /vision/analyze`: 6 / 60s
- `POST /voice/sessions`: 12 / 60s
- `POST /bug-reports`: 5 / 60s
A throttled request returns `429`.

---

## Auth (Phase A)

### `POST /api/v1/auth/register`
- **Auth**: none
- **Body**:
  ```json
  { "email": "user@example.com", "password": "min-8-chars", "displayName": "Jane Doe" }
  ```
- **Success — 201**:
  ```json
  { "accessToken": "eyJhbGciOi...", "refreshToken": "eyJhbGciOi..." }
  ```
- **Errors**: `400` (validation — bad email, password < 8 chars, missing displayName),
  `409` (`"A user with this email already exists"`).

### `POST /api/v1/auth/login`
- **Auth**: none
- **Body**: `{ "email": "user@example.com", "password": "..." }`
- **Success — 200**: same shape as register.
- **Errors**: `400` (validation), `401` (`"Invalid credentials"` — wrong password, unknown
  email, or inactive account), `429` (rate limited after 5 attempts/60s).

### `POST /api/v1/auth/refresh`
- **Auth**: the **refresh token** is sent in the body, not as a Bearer header.
- **Body**: `{ "refreshToken": "eyJhbGciOi..." }`
- **Success — 200**: a **new** `{ accessToken, refreshToken }` pair. The old refresh token is
  immediately revoked (rotation) — the frontend must persist the new one.
- **Errors**: `401` (`"Refresh token is invalid or has been revoked"` — expired, already
  used/rotated, or logged out).

### `POST /api/v1/auth/logout`
- **Auth**: refresh token in body (same mechanism as `/refresh`).
- **Body**: `{ "refreshToken": "eyJhbGciOi..." }`
- **Success — 204**: no body.
- **Errors**: `401` (invalid/already-revoked refresh token).

### `GET /api/v1/users/me`
- **Auth**: `Authorization: Bearer <accessToken>`
- **Success — 200**:
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "role": "USER",
    "isActive": true,
    "createdAt": "2026-09-22T12:00:00.000Z"
  }
  ```
  (`passwordHash` is never present — server-side serialization strips it.)
- **Errors**: `401` (missing/invalid/expired access token).

---

## Health

### `GET /api/v1/health`
- **Auth**: none
- **Success — 200**:
  ```json
  {
    "status": "ok",
    "info": { "postgres": { "status": "up" }, "redis": { "status": "up" } },
    "error": {},
    "details": { "postgres": { "status": "up" }, "redis": { "status": "up" } },
    "environment": "staging",
    "version": { "build": "2026.09.25", "gitCommit": "4835cee" }
  }
  ```
- **Failure — 503**: same shape, a failing check appears under `error` with
  `{"status":"down","message":"..."}` and `status` becomes `"error"`.

---

## Messages (Phase B)

### `POST /api/v1/messages`
- **Auth**: `Authorization: Bearer <accessToken>`
- **Body**:
  ```json
  { "message": "Rappelle-moi mon rendez-vous demain", "conversationId": "uuid (optional)" }
  ```
  `message`: 1–8000 chars, required. `conversationId`: omit to start a new conversation;
  pass an existing one to continue it (must belong to the caller).
- **Success — 201**:
  ```json
  {
    "conversationId": "uuid",
    "messageId": "uuid",
    "response": "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
    "route": "direct",
    "scope": "direct",
    "space": "direct",
    "confidence": 0.9
  }
  ```
  `route`/`scope`: `"direct" | "personal" | "professional" | "hybrid"`.
  `space`: `"direct" | "personal" | "general" | "logistiga" | "piston" | "code" | "hybrid"`.
  `messageId` identifies Mora's reply (the assistant message just created), not the user's
  message.
- **Phase D — optional `action` field**: present **only** when the LLM proposed a tool call
  that needs confirmation (security level N2/N3 — see [Tools & Actions](#tools--actions-phase-d)
  below). Absent for every response shape that existed before Phase D, so this is fully
  backward-compatible with Phase B/C frontends that never look for it.
  ```json
  {
    "conversationId": "uuid",
    "messageId": "uuid",
    "response": "Créer un rappel : \"Appeler Jean\" (2026-09-24T09:00:00Z). Veux-tu confirmer ?",
    "route": "personal",
    "scope": "personal",
    "space": "personal",
    "confidence": 0.85,
    "action": {
      "type": "confirmation_required",
      "pendingActionId": "uuid",
      "tool": "create_reminder",
      "securityLevel": "N2",
      "summary": "Créer un rappel : \"Appeler Jean\" (2026-09-24T09:00:00Z)"
    }
  }
  ```

---

## Bug Reports (Staging / Debug UX)

### `POST /api/v1/bug-reports`
- **Auth**: `Authorization: Bearer <accessToken>`
- **Headers**: optional `X-Request-Id` if the frontend already has one from a failing request.
- **Body**:
  ```json
  {
    "category": "avatar",
    "severity": "high",
    "title": "Avatar freeze after reconnect",
    "description": "The avatar stopped animating after the voice session recovered.",
    "requestId": "req_123",
    "conversationId": "uuid (optional)",
    "voiceSessionId": "uuid (optional)",
    "frontendRoute": "/voice",
    "apiRoute": "/api/v1/voice/sessions",
    "browserInfo": "Chrome 140 / Windows 11",
    "appVersion": "staging-2026-09-25",
    "metadata": { "panel": "voice", "step": "after reconnect" }
  }
  ```
- `category`: `ui | api | voice | vision | avatar | auth | performance | other`
- `severity`: `low | medium | high | critical`
- **Success — 201**:
  ```json
  {
    "id": "uuid",
    "userId": "uuid",
    "requestId": "req_123",
    "conversationId": "uuid",
    "voiceSessionId": "uuid",
    "category": "avatar",
    "severity": "high",
    "title": "Avatar freeze after reconnect",
    "description": "The avatar stopped animating after the voice session recovered.",
    "frontendRoute": "/voice",
    "apiRoute": "/api/v1/voice/sessions",
    "browserInfo": "Chrome 140 / Windows 11",
    "appVersion": "staging-2026-09-25",
    "metadata": { "panel": "voice", "step": "after reconnect" },
    "status": "open",
    "createdAt": "2026-09-25T12:00:00.000Z",
    "updatedAt": "2026-09-25T12:00:00.000Z"
  }
  ```
- **Security rule**: metadata is sanitized server-side; secrets/tokens/passwords/API keys are
  dropped or redacted rather than persisted.

### `GET /api/v1/bug-reports`
- **Auth**: Bearer token, `ADMIN` role only.
- **Query**: `status?`, `userId?`, `requestId?`, `limit?`
- **Success — 200**: array of bug reports.

### `PATCH /api/v1/bug-reports/:id`
- **Auth**: Bearer token, `ADMIN` role only.
- **Body**:
  ```json
  { "status": "investigating" }
  ```
- `status`: `open | investigating | resolved | ignored`
- **Success — 200**: updated bug report row.
  When `action` is present, **nothing has been executed yet** — the frontend should render a
  confirm/cancel card and call `POST /pending-actions/:id/approve` or `/reject` (see below).
  When `action` is absent, the response is final (either a plain reply, or an N1 tool — e.g.
  `list_tasks` — already executed automatically and summarized in `response`).
- **Errors**: `400` (validation — empty/too-long message, malformed `conversationId`),
  `401` (no/invalid access token), `403` (`conversationId` belongs to another user), `404`
  (`conversationId` does not exist).

**Example — professional/Logistiga:**
```json
// Request
{ "message": "Vérifie le statut de la commande Logistiga" }
// Response (no LLM configured)
{
  "conversationId": "8f1c...",
  "messageId": "a92e...",
  "response": "Configuration LLM manquante : aucun provider n'est configuré (OPENAI_API_KEY absent). Cette réponse est un espace réservé — configurez un provider pour obtenir une vraie réponse.",
  "route": "professional",
  "scope": "professional",
  "space": "logistiga",
  "confidence": 0.9
}
```

**Example — hybrid (blocked):**
```json
// Request
{ "message": "Rappelle-moi mon rendez-vous perso et vérifie aussi le client Logistiga" }
// Response
{
  "conversationId": "...",
  "messageId": "...",
  "response": "Votre demande mélange des éléments personnels et professionnels. Le mode cross-scope est désactivé par défaut : merci de reformuler séparément la partie personnelle et la partie professionnelle.",
  "route": "hybrid",
  "scope": "hybrid",
  "space": "hybrid",
  "confidence": 0.7
}
```

### `GET /api/v1/conversations`
- **Auth**: Bearer token. Returns only the caller's own conversations.
- **Success — 200**: array, newest-updated first.
  ```json
  [
    {
      "id": "uuid",
      "userId": "uuid",
      "title": null,
      "createdAt": "2026-09-22T12:00:00.000Z",
      "updatedAt": "2026-09-22T12:05:00.000Z"
    }
  ]
  ```
  Note: `title` is always `null` in Phase B (no auto-titling implemented). No messages are
  included here — fetch `GET /conversations/:id` for the thread.

### `GET /api/v1/conversations/:id`
- **Auth**: Bearer token. `403` if the conversation belongs to another user.
- **Success — 200**:
  ```json
  {
    "id": "uuid",
    "userId": "uuid",
    "title": null,
    "createdAt": "...",
    "updatedAt": "...",
    "messages": [
      {
        "id": "uuid",
        "conversationId": "uuid",
        "role": "USER",
        "content": "Bonjour",
        "scope": "direct",
        "space": "direct",
        "metadata": { "intent": "greeting", "method": "rules" },
        "createdAt": "..."
      },
      {
        "id": "uuid",
        "conversationId": "uuid",
        "role": "ASSISTANT",
        "content": "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        "scope": "direct",
        "space": "direct",
        "metadata": { "agent": "direct" },
        "createdAt": "..."
      }
    ]
  }
  ```
  `messages` is ordered oldest → newest. `role` is `"USER" | "ASSISTANT"` in practice (the
  `SYSTEM` enum value exists in the schema but Phase B never creates one).
- **Errors**: `401`, `403`, `404` (unknown id).

### `GET /api/v1/router-decisions`
- **Auth**: Bearer token. Returns only decisions for the caller's own conversations, newest
  first, capped at 50.
- **Success — 200**:
  ```json
  [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "messageId": "uuid",
      "route": "professional",
      "scope": "professional",
      "space": "logistiga",
      "intent": "question",
      "complexity": "low",
      "securityLevel": "medium",
      "confidence": 0.9,
      "metadata": { "method": "rules" },
      "createdAt": "..."
    }
  ]
  ```
- **Errors**: `401`.

---

## Memories (Phase C)

Every endpoint below is Bearer-authenticated and **always** scoped to the caller's own
`userId` server-side — there is no way to request another user's data, even by guessing an id
(`403`/`404` instead).

### `GET /api/v1/memories`
- **Query params** (all optional): `scope` (`personal|professional`), `space`
  (`personal|general|logistiga|piston|code`), `kind`
  (`fact|preference|person|company|decision|procedure|event|project|habit`), `status`
  (`active|pending|archived|superseded`, **defaults to `active`** if omitted), `search`
  (case-insensitive substring match over `content`).
- **Success — 200**: array of Memory objects (see below), newest-updated first, capped at 100.
- **Errors**: `401`, `400` (invalid enum value for scope/space/kind/status).

### `GET /api/v1/memories/:id`
- **Success — 200**: one Memory object.
- **Errors**: `401`, `403` (not yours), `404`.

### `POST /api/v1/memories`
- **Body**:
  ```json
  {
    "scope": "personal",
    "space": "personal",
    "kind": "preference",
    "content": "Préfère recevoir ses rappels de façon courte et directe",
    "importance": 0.7,
    "confidence": 0.8,
    "metadata": {}
  }
  ```
  `scope`/`space`/`kind` required (see enums above). `content`: 1–4000 chars, required.
  `importance`/`confidence`: optional, 0–1, default `0.5` each. `metadata`: optional free-form
  object.
- **Success — 201**: the created Memory, `status: "active"`, `source: "manual"`. An embedding
  job is queued in the background (see "LLM/embedding configuration" below) — the response
  never includes an embedding.
- **Errors**: `400` (validation), `401`.

### `PATCH /api/v1/memories/:id`
- **Body** (all optional): `content`, `importance`, `confidence`, `validUntil` (ISO date),
  `metadata`. Does **not** accept `status` — use the archive endpoint for that.
- **Success — 200**: the updated Memory. Changing `content` re-queues the embedding job.
- **Errors**: `400`, `401`, `403`, `404`.

### `POST /api/v1/memories/:id/archive`
- **Success — 201**: the Memory with `status: "archived"`.
- **Errors**: `401`, `403`, `404`.

**Memory object shape:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "scope": "personal",
  "space": "personal",
  "kind": "preference",
  "content": "Préfère recevoir ses rappels de façon courte et directe",
  "importance": 0.7,
  "confidence": 0.8,
  "source": "manual",
  "sourceId": null,
  "status": "active",
  "validFrom": "2026-09-22T12:00:00.000Z",
  "validUntil": null,
  "lastAccessedAt": null,
  "accessCount": 0,
  "supersededById": null,
  "embeddingModel": null,
  "embeddingDimensions": null,
  "metadata": {},
  "createdAt": "...",
  "updatedAt": "..."
}
```
Note: there is **no `embedding` field in any API response** — the vector itself is never
serialized to JSON (it lives only in Postgres/pgvector). `embeddingModel`/`embeddingDimensions`
are `null` until the background embedding job completes (or forever, if no embedding provider
is configured — see below).

There is **no supersede endpoint** in Phase C: superseding (replacing an old memory with a new
one, keeping history) happens automatically via the background extraction pipeline when it
detects a near-duplicate/contradicting fact. A superseded memory keeps `status: "superseded"`
and its `supersededById` points at the replacement; it is excluded from the default (`status`
unset → `active`) list but still fetchable directly by id.

### `GET /api/v1/profile-facts`
- **Query params** (optional): `scope`, `space`, `status` (default `active`).
- **Success — 200**: array of ProfileFact objects (stable profile-level facts — preferences,
  habits, relationships — distinct from the more numerous, conversation-sourced Memory rows).
  ```json
  [
    {
      "id": "uuid",
      "userId": "uuid",
      "scope": "personal",
      "space": "personal",
      "key": "communication_style",
      "value": "concise",
      "confidence": 0.8,
      "source": "manual",
      "status": "active",
      "validFrom": "...",
      "validUntil": null,
      "supersededById": null,
      "metadata": {},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
  ```
- **Errors**: `401`.
- **No POST/PATCH endpoint yet** — profile facts are read-only via the API in Phase C.

### `GET /api/v1/entities`
- **Query params** (optional): `scope`, `space`, `type`
  (`person|company|client|project|place|equipment|object`).
- **Success — 200**: array of Entity objects (people/companies/etc. referenced by memories).
  ```json
  [
    { "id": "uuid", "userId": "uuid", "scope": "professional", "space": "logistiga",
      "type": "company", "name": "Logistiga", "aliases": [], "metadata": {},
      "createdAt": "...", "updatedAt": "..." }
  ]
  ```
- **Errors**: `401`.
- **No POST endpoint yet** — entities are created only internally by the extraction pipeline
  (deduped by `userId+scope+space+type+name`) and are read-only via the API.

### `GET /api/v1/conversation-summaries`
- **Query params**: `conversationId` (optional UUID) — narrows to one conversation; omit to
  list all of the caller's summaries.
- **Success — 200**: array. A conversation can have **up to one summary per (scope, space)**
  combination it has touched (summaries stay scope-isolated, same as memories).
  ```json
  [
    { "id": "uuid", "conversationId": "uuid", "userId": "uuid", "scope": "personal",
      "space": "personal", "summary": "L'utilisateur organise le rendez-vous de sa fille...",
      "fromMessageId": "uuid", "toMessageId": "uuid", "messageCount": 24,
      "approxTokenCount": 180, "createdAt": "...", "updatedAt": "..." }
  ]
  ```
- **Errors**: `401`.
- A summary only appears once a conversation has accumulated enough messages in that
  scope/space (`MORA_SUMMARY_MESSAGE_THRESHOLD`, default 20) **and** an LLM provider is
  configured — with no LLM, this list stays empty indefinitely (never an error, just no data).

## LLM / embedding configuration — how it shows up in responses

Nothing in the API tells the frontend directly whether an LLM or embedding provider is
configured — infer it from behavior:
- `POST /messages` response `response` text equal to the fixed "Configuration LLM manquante…"
  placeholder ⇒ no LLM configured.
- A Memory's `embeddingModel`/`embeddingDimensions` staying `null` well after creation ⇒ no
  embedding provider configured (or it failed — the app never surfaces which, by design: the
  memory is still fully usable via text search either way).
- `GET /conversation-summaries` staying empty despite a long conversation ⇒ no LLM configured
  (summaries need one).

---

## AI Providers (Phase C.5)

Every endpoint below is Bearer-authenticated and scoped to the caller's own `userId` — no
endpoint accepts a client-supplied `userId`. **No response, ever, contains the API key** — only
`hasKey` (boolean) and `keyHint` (last 4 characters).

### `GET /api/v1/ai-providers`
- **Query params** (optional): `kind` (`chat|embedding|vision|stt|tts|image|avatar|...`),
  `scope` (`personal|professional`), `space`, `isActive` (`"true"|"false"`).
- **Success — 200**: array, ordered `isDefault` desc, then `priority` desc, then
  `updatedAt` desc. See `AiProvider` shape below.
- **Errors**: `401`.

### `GET /api/v1/ai-providers/:id`
- **Success — 200**: one `AiProvider`. **Errors**: `401`, `403` (not yours), `404`.

### `POST /api/v1/ai-providers`
- **Body**:
  ```json
  {
    "name": "My OpenAI",
    "provider": "openai",
    "kind": "chat",
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "isActive": true,
    "isDefault": false,
    "scope": "professional",
    "space": "logistiga",
    "capabilities": { "chat": true, "tools": true, "streaming": true },
    "settings": { "maxTokens": 1024, "timeoutMs": 30000 },
    "priority": 0
  }
  ```
  Required: `name`, `provider`, `kind`, `model`. Everything else optional — `apiKey` may be
  omitted entirely for a no-auth-needed local provider (e.g. Ollama). `baseUrl`, when given,
  must be a URL with a scheme (`http://` or `https://` — a bare hostname is rejected).
- **Success — 201**: the created provider (public view — see `AiProvider` shape). If
  `isDefault: true`, any other default for the same (kind, scope, space) is unset first
  (transactional; also enforced by a DB constraint).
- **Errors**: `400` (validation), `401`.

### `PATCH /api/v1/ai-providers/:id`
- **Body**: any subset of the create fields except `provider`/`kind` (immutable after
  creation). **Omit `apiKey` to keep the existing key untouched.** Sending a new `apiKey`
  rotates it (re-encrypted with a fresh IV) — the old one is gone, never returned.
- **Success — 200**: the updated provider. **Errors**: `400`, `401`, `403`, `404`.

### `POST /api/v1/ai-providers/:id/enable` / `/disable`
- **Success — 201**: the updated provider (`isActive: true`/`false`). A disabled provider is
  never selected by the chat/embedding pipeline. **Errors**: `401`, `403`, `404`.

### `POST /api/v1/ai-providers/:id/set-default`
- **Success — 201**: the updated provider (`isDefault: true`); any sibling default for the same
  (kind, scope, space) is unset. **Errors**: `401`, `403`, `404`.

### `POST /api/v1/ai-providers/:id/test`
- Makes one real, minimal call through the actual provider (a 1-token chat completion, or an
  embedding of the word "test") — no large prompt, no wasted tokens.
- **Success — 201**: `{ "success": true, "message": "Chat completion succeeded" }` (or
  `false` with a short, sanitized failure message — **never** an HTTP error status for a failed
  test; the test itself succeeded in running, its *result* is what's reported).
  ```json
  { "success": false, "message": "Chat provider request failed with status 401: ..." }
  ```
  Also updates the provider's `lastTestedAt`/`lastTestStatus`/`lastTestMessage` (visible on
  subsequent `GET`s). **Errors**: `401`, `403`, `404`.

### `DELETE /api/v1/ai-providers/:id`
- **Success — 204**: no body. This is a **real, hard delete** (not archive) — see
  `FRONTEND_HANDOFF.md` §12 for why, and warrants a confirm dialog in the UI.
- **Errors**: `401`, `403`, `404`.

### `GET /api/v1/ai-providers/status`
- **Success — 200**:
  ```json
  {
    "chatConfigured": true,
    "embeddingConfigured": true,
    "visionConfigured": false,
    "sttConfigured": false,
    "ttsConfigured": false,
    "imageConfigured": false,
    "avatarConfigured": false,
    "defaults": {
      "chat": { "id": "uuid", "name": "My OpenAI", "provider": "openai", "model": "gpt-4o-mini" },
      "embedding": { "id": "uuid", "name": "My Embeddings", "provider": "openai", "model": "text-embedding-3-small" },
      "vision": null, "stt": null, "tts": null, "image": null, "avatar": null
    }
  }
  ```
- **Errors**: `401`.

**`AiProvider` response shape** (every endpoint above except `/test` and `/status`):
```json
{
  "id": "uuid",
  "name": "My OpenAI",
  "provider": "openai",
  "kind": "chat",
  "baseUrl": null,
  "model": "gpt-4o-mini",
  "hasKey": true,
  "keyHint": "7890",
  "isActive": true,
  "isDefault": true,
  "scope": null,
  "space": null,
  "capabilities": {},
  "settings": {},
  "priority": 0,
  "lastTestedAt": "2026-09-22T18:00:00.000Z",
  "lastTestStatus": "success",
  "lastTestMessage": "Chat completion succeeded",
  "createdAt": "...",
  "updatedAt": "..."
}
```
Note what's **absent**: `apiKeyEncrypted`, `apiKeyIv`, `apiKeyAuthTag`, and any plaintext key
field — these never leave the server.

### Effect on other endpoints
`POST /api/v1/messages` (personal/professional routes) and the background memory-embedding job
now try the caller's own AI Provider (matching kind + best scope/space match) **before** the
legacy env fallback (`OPENAI_API_KEY`/`MORA_EMBEDDING_*`). Nothing else about those endpoints'
request/response shape changed.

---

## Tools & Actions (Phase D)

Mora can now **act** (tasks, reminders), not just converse/remember — but always under backend
control. See `docs/frontend/FRONTEND_HANDOFF.md` for the full conversational UX this is meant to
support (confirmation cards, etc).

**Security levels** (`securityLevel` on a tool/pending action):
- `N1` (auto) — read-only or low-risk (e.g. `list_tasks`, `search_memories`): executes
  immediately, no confirmation, result already reflected in `/messages`' `response` text.
- `N2` (confirmation) — modifies state but reversible (e.g. `create_task`, `create_reminder`,
  `complete_task`, `cancel_reminder`): **always** requires `POST /pending-actions/:id/approve`.
- `N3` (sensitive) — reserved for future external actions (Phase E). No N3 tool ships in
  Phase D; same confirmation requirement as N2 when one exists.
- `N4` (critical) — reserved, never auto-executed, never approvable. No N4 tool ships in
  Phase D.

**Important distinction**: a direct REST call below (`POST /tasks`, `POST /reminders`, ...) made
by an authenticated user **is itself the explicit confirmation** and executes immediately, even
for an N2-level action — the REST call *is* the user's intent. Only a tool call **proposed by
the LLM** from `POST /messages` goes through the `pending_action` confirmation flow.

### `GET /api/v1/tools`
- **Auth**: Bearer token.
- **Success — 200**: public metadata only — never internal code or secrets.
  ```json
  [
    { "name": "create_task", "description": "...", "securityLevel": "N2", "requiresConfirmation": true, "allowedScopes": ["personal", "professional"] },
    { "name": "list_tasks", "description": "...", "securityLevel": "N1", "requiresConfirmation": false, "allowedScopes": ["personal", "professional"] }
  ]
  ```

### Tasks
- `GET /api/v1/tasks?scope=&space=&status=` — list, scoped to the caller.
- `GET /api/v1/tasks/:id` — one task (`403` if it belongs to another user).
- `POST /api/v1/tasks` — body: `{ scope: "personal"|"professional", space: string, title: string, description?, priority?: "low"|"normal"|"high"|"urgent", dueAt?: ISO8601 }`. Executes immediately (REST = explicit confirmation).
- `PATCH /api/v1/tasks/:id` — body: any subset of `{ title, description, status: "pending"|"in_progress"|"completed"|"cancelled", priority, dueAt }`.
- `POST /api/v1/tasks/:id/complete` — shortcut for `status: "completed"`.
- `POST /api/v1/tasks/:id/cancel`.
- **Task shape**:
  ```json
  {
    "id": "uuid", "userId": "uuid", "scope": "personal", "space": "personal",
    "title": "Appeler Jean", "description": null, "status": "pending", "priority": "normal",
    "dueAt": null, "completedAt": null, "source": "manual",
    "sourceConversationId": null, "createdAt": "...", "updatedAt": "..."
  }
  ```
  `source`: `"manual"` (REST) or `"tool"` (created via an approved LLM tool call).

### Reminders
- `GET /api/v1/reminders?scope=&space=&status=` — list.
- `GET /api/v1/reminders/:id`.
- `POST /api/v1/reminders` — body: `{ scope, space, title, message?, remindAt: ISO8601 }`. Schedules a real BullMQ delayed job.
- `POST /api/v1/reminders/:id/cancel` — idempotent no-op if already delivered/cancelled.
- **Reminder shape**: `status: "scheduled"|"delivered"|"cancelled"|"failed"`, plus `deliveredAt`/`cancelledAt` timestamps.
- **Delivery**: Phase D delivers a due reminder as exactly one internal `Notification` (`type: "reminder"`) — no email/WhatsApp/push yet (Phase E).

### Pending Actions (the confirmation flow)
- `GET /api/v1/pending-actions` — the caller's own pending actions, newest first.
- `GET /api/v1/pending-actions/:id`.
- `POST /api/v1/pending-actions/:id/approve` — executes the underlying tool.
  ```json
  { "status": "executed", "pendingAction": { "...": "...", "result": { "id": "uuid", "title": "..." } }, "toolResultOk": true }
  ```
  A second approve on the same id returns `{ "status": "already_processed", ... }` and never
  executes twice (idempotent — see the Phase D final report for the concurrency proof).
- `POST /api/v1/pending-actions/:id/reject` — never executes the tool; `{ "status": "rejected", ... }`.
- A pending action **expires** 30 minutes after creation (`expiresAt`); approving an expired one
  returns `{ "status": "expired", ... }` and executes nothing.
- **Errors**: `403` if the pending action belongs to another user (never even visible via GET).

### Notifications
- `GET /api/v1/notifications?status=unread|read`.
- `POST /api/v1/notifications/:id/read`.
- `POST /api/v1/notifications/read-all`.
- **Shape**: `{ id, userId, type, title, message, status: "unread"|"read", metadata, readAt, createdAt }`. `metadata.reminderId` links a `type: "reminder"` notification back to its reminder.

---

## Documents & Document Intelligence (Phase E)

- `POST /api/v1/documents` (`multipart/form-data`) — fields: `file`, `scope`, `space`. Accepts
  PDF/DOCX/TXT/MD/CSV/XLSX only (25MB default max). Returns the `Document` row with
  `status: "uploaded"`/`"queued"` — processing (extract → classify → tag → extract entities →
  summarize → chunk → embed) happens asynchronously via BullMQ. Identical content
  (SHA-256 checksum) re-uploaded by the same user/scope/space returns the existing document,
  never a duplicate.
- `GET /api/v1/documents?scope=&space=&status=&documentType=&tag=&source=&needsReview=` — list, scoped to the caller.
- `GET /api/v1/documents/:id` — full detail: `{ document, tags: string[], entities: Entity[], tables: DocumentTable[] }`.
- `GET /api/v1/documents/:id/status` — lightweight polling shape: `{ id, status, needsReview, errorMessage, processedAt }`.
- `POST /api/v1/documents/:id/reprocess` — re-runs the pipeline (e.g. after a transient failure).
- `PATCH /api/v1/documents/:id` — `{ title?, tags?: string[] }` (manual tag additions).
- `POST /api/v1/documents/:id/archive`.
- **`Document.status`**: `uploaded → queued → processing → ready | needs_review | failed | archived`.
  `needs_review: true` means low classification confidence OR no extractable text (no OCR in
  Phase E — a scanned PDF lands here, not silently indexed as empty).
- **Citations**: results from document search always carry `documentId`, `documentTitle`, and
  `page`/`section` when known — render as e.g. *"Source : Rapport Rotor — page 12"*.
- **Tables**: CSV/XLSX (and any tables found in a PDF) are stored structurally
  (`document_tables` + `document_table_rows`), not flattened to text only — analytical
  questions ("quel client a le plus d'impayés ?") go through a controlled group-by/aggregate
  query, never free-form SQL.

## Contacts (Phase E)

- `GET /api/v1/contacts?scope=&space=&trustLevel=&search=`.
- `GET /api/v1/contacts/:id` — includes `identities: ContactIdentity[]`.
- `POST /api/v1/contacts` — `{ name, scope, space, company?, trustLevel? }`.
- `PATCH /api/v1/contacts/:id` — `{ name?, company?, trustLevel?, notes?, tags? }`.
- `POST /api/v1/contacts/:id/identities` — `{ type: "whatsapp"|"email", value }`. The same
  WhatsApp number/email can only ever belong to one contact per user — attaching an identity
  already owned by a different contact returns `409`.
- **`trustLevel`**: `unknown | known | trusted | vip | restricted | blocked`. `blocked` is
  enforced by the WhatsApp/Email connectors (a blocked contact's inbound messages are never
  stored beyond an audit entry, and no reply is ever drafted for them).

## Calendar (Phase E)

- `GET /api/v1/calendar/events?scope=&space=&from=&to=` — Mora's own internal calendar
  (`MoraCalendarProvider`) — works standalone, no Google/Microsoft account needed.
- `GET /api/v1/calendar/events/:id`.
- `POST /api/v1/calendar/events` — `{ scope, space, title, description?, location?, startsAt, endsAt, participantContactIds? }`. `timezone` defaults to the backend's explicit `TimeContextService` timezone (never left implicit — see Phase D's date-hallucination fix).
- `PATCH /api/v1/calendar/events/:id`.
- `POST /api/v1/calendar/events/:id/cancel`.
- `GET /api/v1/calendar/free-slots?scope=&space=&from=&to=&durationMinutes=` — real gaps
  between existing events within working hours (8h–18h backend-timezone).

## WhatsApp (Phase E — Mora's own number, never the user's personal WhatsApp)

- `GET /api/v1/whatsapp/accounts`, `POST /api/v1/whatsapp/accounts` — `{ label, phoneNumber, provider: "evolution"|"meta_cloud", config?, apiKey? }`. Credentials AES-256-GCM encrypted, never returned.
- `GET /api/v1/whatsapp/accounts/:id/health` — `{ connected: boolean, error? }`.
- `GET /api/v1/whatsapp/conversations?accountId=`, `GET /api/v1/whatsapp/conversations/:id/messages`.
- `POST /api/v1/webhooks/whatsapp/:accountId` — Evolution API webhook target (not a
  frontend-facing endpoint), secured by a shared-secret header (`X-Webhook-Secret`,
  `MORA_WHATSAPP_WEBHOOK_SECRET`).
- Sending is **tool-only** (`whatsapp_send_message`/`whatsapp_send_document`, both N2 —
  always a `pending_action`), never a direct REST "send" endpoint — see Tools & Actions.
- **Test status**: Evolution API integration is real code, CONTRACT-tested only (mocked HTTP) —
  no real Evolution instance was reachable without touching the production VPS. See the Phase E
  final report.

## Email (Phase E — Mora's own mailbox(es), never the user's personal inbox)

- `GET /api/v1/email/accounts`, `POST /api/v1/email/accounts` — `{ label, address, provider: "imap_smtp"|"gmail"|"microsoft_graph", imapHost?, imapPort?, smtpHost?, smtpPort?, username?, password? }`. Credentials encrypted, never returned.
- `GET /api/v1/email/accounts/:id/health`, `POST /api/v1/email/accounts/:id/sync` (pulls recent unseen messages via IMAP).
- `GET /api/v1/email/threads?accountId=`, `GET /api/v1/email/threads/:id/messages`.
- Inbound HTML is sanitized at ingest (`htmlBodySanitized`) — the raw provider HTML is never
  stored or rendered.
- Sending is **tool-only** (`email_send`/`email_send_attachment`, both N2), never a direct REST
  endpoint.
- **Test status**: IMAP/SMTP integration is real code (`imapflow`/`nodemailer`),
  CONTRACT-tested only — no real mailbox credentials were available. See the Phase E final report.

## Business connectors — LogistiGA / Piston (Phase E, READ-ONLY)

No REST endpoints — access is exclusively through the `logistiga_*`/`piston_*` tools (N1,
read-only, only usable in `scope: "professional"` + the matching `space`). **Test status**: no
real LogistiGA/Piston database schema or credentials were available — both connectors are
FIXTURE-based (small synthetic datasets), documented explicitly as such. Real schema inspection
and a real read-only DB role are prerequisites for a genuine connector, deferred until
authorized access is available.

## Tools & Actions — Phase E additions

34 new tools registered alongside Phase D's 12 (46 total, `GET /tools` lists all of them):
`search_documents`, `get_document`, `search_document_content`, `query_document_table` (N1);
`list_contacts`, `get_contact`, `search_contacts` (N1), `create_contact`, `update_contact` (N2);
`whatsapp_list_conversations`, `whatsapp_read_messages`, `whatsapp_search_messages`,
`whatsapp_get_contact`, `whatsapp_draft_reply` (N1), `whatsapp_send_message`,
`whatsapp_send_document` (N2); `email_list_threads`, `email_read_thread`, `email_search`,
`email_draft_reply` (N1), `email_send`, `email_send_attachment` (N2); `calendar_list_events`,
`calendar_get_event`, `calendar_find_free_slots` (N1), `calendar_create_event`,
`calendar_update_event`, `calendar_cancel_event` (N2); `logistiga_search`,
`logistiga_get_entity`, `logistiga_get_summary`, `piston_search`, `piston_get_entity`,
`piston_get_summary` (N1, professional-only). Every N2 tool follows the exact same
`pending_action` confirmation flow documented in Phase D — nothing new for the frontend to
learn beyond the tool names.

---

## Voice (Phase F + Phase H) — REAL-TIME VOICE ENGINE + AVATAR EVENTS

**Core principle: voice is a CHANNEL, not a new assistant.** A voice turn ends up calling the
exact same Orchestrator/Router/Agents/Memory/Documents/Tools pipeline as a normal text message
(`POST /messages`) — the frontend should think of voice purely as an alternate way to produce a
`transcript.final` (equivalent to typing a message) and to receive the response as streamed
audio instead of (or alongside) text.

### REST endpoints

- `POST /voice/sessions` — body `{ scope, space, conversationId?, language?, mode?, timezone? }`
  (`language` defaults `"auto"`, `mode` defaults `"push_to_talk"`). Returns the created
  `VoiceSession` (status `"created"`). Omit `conversationId` to start a new conversation — the
  session's `conversationId` can then be reused by `POST /messages` to continue the same
  conversation in text.
- `GET /voice/sessions/:id` — 403 if the session belongs to another user.
- `POST /voice/sessions/:id/end` — ends the session (idempotent).
- `GET /voice/profiles` / `POST /voice/profiles` / `PATCH /voice/profiles/:id` — `MoraVoiceProfile`
  CRUD: `{ name, provider, voiceId, language?, speed?, isDefault? }`. Never returns an API key —
  voice profiles never carry credentials (those live exclusively on the backend's AI Provider
  Manager).
- `GET /voice/status` — `{ protocolVersion, audioFormat, sttConfigured, ttsConfigured, providers: { stt, tts } }`.
  Use this to decide whether to show the mic button as available before opening a session.

### WebSocket transport

Connect to `wss://<host>/voice/ws?token=<accessToken>` (the same JWT access token used for REST
calls, as a query parameter since browser WebSocket clients cannot set an `Authorization`
header). The connection closes immediately with a 4xxx code if the token is missing/invalid
(`4001`), the referenced session doesn't exist or isn't yours (`4003`), the session already has
another active connection (`4005`), or the session exceeded its 2-hour max duration (`4004`).

**One socket = one session = one user.** After connecting, send `session.start` referencing a
session id created via the REST endpoint above; the server replies `session.ready` once
listening begins.

**Audio format** (both directions): PCM16 little-endian, mono, 16kHz. Send raw binary WebSocket
frames (recommended ~200ms each, hard cap 32KB/frame). Outbound assistant audio (`audio.out.chunk`)
is streamed as binary frames too, but is **MP3-encoded** (OpenAI TTS output), not PCM — play it
with a standard `<audio>`/MediaSource pipeline, not a raw PCM player.

**Protocol version**: `1` (`VOICE_PROTOCOL_VERSION`). Client and server both include it; a future
breaking change bumps this and old clients should show an upgrade prompt rather than silently
misbehaving.

#### Client → Server events (JSON text frames unless noted)

| Event | Payload | Notes |
|---|---|---|
| `session.start` | `{ sessionId }` | First message after connecting. |
| *(binary frame)* | raw PCM16 | Sent continuously while the user is speaking. |
| `audio.end` | — | Push-to-talk release — forces STT finalization even if VAD hasn't detected silence yet. |
| `session.interrupt` | — | Barge-in: stop the assistant immediately. |
| `session.pause` / `session.resume` | — | |
| `session.end` | — | Closes the session. |

#### Server → Client events

| Event | Payload | Notes |
|---|---|---|
| `session.ready` | `{ sessionId, state, protocolVersion, audioFormat }` | |
| `transcript.final` | `{ text }` | The ONLY transcript event Phase F emits — see below. |
| `avatar.state` | `{ state, channel, expression, intensity, canInterrupt, pendingConfirmation, connection, sessionId?, conversationId?, scope?, space?, sourceType?, errorCode? }` | Phase H realtime avatar state. `connection`: `connected | reconnecting | disconnected`. |
| `avatar.lipsync` | `{ mode, source, channel, durationMs, textLength, cues[] }` | Phase H estimated lip-sync contract. Each cue is `{ startMs, endMs, viseme, weight }`. |
| `assistant.thinking.started` | — | Orchestrator call in flight. |
| `assistant.speaking.started` / `assistant.speaking.ended` | — | Speech lifecycle hooks; Phase H avatar state and lip-sync are emitted alongside these events. |
| `assistant.expression` | `{ expression, intensity, state, channel, source }` | Phase H controlled expression signal (`neutral`, `attentive`, `thinking`, `explaining`, `vision_focus`, `confirming`, `celebrating`, `concerned`, `error`). |
| *(binary frame)* | MP3 bytes | Assistant audio, streamed sentence by sentence as it's synthesized. |
| `action.pending_confirmation` | `{ pendingActionId, tool, securityLevel, summary }` | An N2/N3 tool call needs a spoken "oui"/"non" — same semantics as the text-chat `action` field. |
| `action.executed` | `{ pendingActionId, toolName }` | |
| `action.clarification_needed` | `{ candidateCount }` | More than one pending action is open in this session — the backend will NOT guess which "oui" refers to; ask the user which one, or point them to `GET /pending-actions`. |
| `session.interrupted` | — | Confirms a barge-in was processed. |
| `session.state_changed` | `{ state }` | Emitted for pause/resume. |
| `session.ended` | — | |
| `latency.metrics` | `{ sttLatencyMs, llmLatencyMs, ttsFirstByteMs, totalLatencyMs }` | Useful for an optional debug overlay. |
| `error` | `{ code, message }` | Always sanitized — never a raw provider error or a stack trace. |

**IMPORTANT — no partial transcripts in Phase F.** `transcript.partial` is reserved in the
protocol type for a future streaming-capable STT provider, but the shipped OpenAI Whisper
adapter is batch-only (`supportsPartialTranscripts: false`) — it produces one transcript per
turn, sent as `transcript.final`. Do not build UI that waits for `transcript.partial` updates;
show a "listening…"/waveform indicator instead until `transcript.final` arrives.

**Phase H avatar mapping:** the backend now emits deterministic avatar state transitions for the
same voice session:
- `session.ready` / `session.resume` -> `avatar.state: listening`
- `assistant.thinking.started` -> `avatar.state: thinking` + `assistant.expression`
- `assistant.speaking.started` -> `avatar.state: speaking` + `assistant.expression` + `avatar.lipsync`
- `action.pending_confirmation` -> `avatar.state: confirming`
- `session.interrupt` or implicit barge-in -> `avatar.state: interrupted`, then `listening`
- `session.pause` -> `avatar.state: paused`
- `error` -> `avatar.state: error`
- reconnect to an already-running session -> transient `avatar.state` with `connection: "reconnecting"` before the normal connected state
- `session.end` -> `avatar.state: disconnected`

**Confirmation via voice**: a bare "oui" is only ever bound to a `pendingActionId` that was
raised in *that same session*. If two pending actions are open, the backend replies
`action.clarification_needed` rather than approving/rejecting either — the frontend should
surface both pending actions (e.g. via `GET /pending-actions`) and let the user pick, or ask them
to say which one explicitly.

### Test status (Phase F)

- **OpenAI STT (Whisper) and OpenAI TTS**: REAL — verified with an actual API call each (real
  French synthesized audio, correctly transcribed back) against a real OpenAI account, reusing
  the same encrypted credentials already configured for chat/embedding (no new key required).
- **VAD (energy/RMS-based)**: REAL, working implementation — not Silero/WebRTC VAD (documented
  limitation, sufficient for the MVP; the real bottleneck is network latency, not VAD accuracy).
- **WebSocket session lifecycle, auth, ownership, one-socket-per-session, audio flood guard**:
  REAL, covered by automated e2e tests.
- **Full audio-in → STT → Orchestrator → TTS → audio-out chained in one single automated test**:
  NOT run end-to-end automatically in this environment (would require a real user's provider
  credentials wired to a synthetic-audio e2e fixture); each stage was instead verified
  independently (STT/TTS for real, Orchestrator reuse via the existing 116 Phase A-E e2e tests,
  gateway wiring via new voice e2e tests). See the Phase F final report for full detail.
- **Wake word**: NOT implemented as a real detector — `mode: "wake_word"` is accepted by the API
  but currently resolves to an explicitly-labeled simulated/no-op detector
  (`isRealAudioTested: false`). Use `push_to_talk` or `continuous_session` for now.
- **Avatar realtime backend**: REAL in Phase H — profile/status REST endpoints, controlled
  expressions, reconnect/disconnect states, and estimated lip-sync payloads are implemented and
  covered by automated tests. No browser renderer ships in this backend repo.

---

## Vision (Phase G) — MULTIMODAL IMAGE CHANNEL

**Core principle: vision is a CHANNEL, not a separate assistant.** The uploaded image(s) are
analyzed first, then the resulting visual context is injected into the exact same
Orchestrator/Router/Agents/Memory/Documents pipeline as a normal Mora turn. The frontend
should think "same conversation, extra visual input", not "new product surface with a separate
brain".

### REST endpoints

- `GET /vision/status?scope=<personal|professional>&space=<space>` — tells the client whether a
  vision-capable provider is configured for that exact scope/space pair. Returns
  `{ visionConfigured, provider, supportedMimeTypes, maxFiles, maxUploadBytes, features }`.
  Use it before showing an enabled camera/screenshot/upload UI.
- `POST /vision/analyze` (`multipart/form-data`) — fields:
  - `files`: **1 to 4** image files, multipart field name exactly `files`
  - `message`: required user question / instruction
  - `scope`: `personal` | `professional`
  - `space`: required (`personal` for personal turns; `general` | `logistiga` | `piston` | `code`
    for professional turns)
  - `conversationId?`: continue an existing conversation instead of creating a new one
  - `sourceType?`: `upload` | `camera` | `screenshot` | `voice_snapshot` | `document`
- `GET /vision/assets/:id` — returns a **sanitized** view of one owned asset
  (`id`, conversation/message ids, scope/space, sourceType, filename, mime/extension, size,
  dimensions, status, summary, extractedText, analysis, errorMessage, timestamps). It does
  **not** expose storage internals like `storageKey`, `storageProvider`, or checksums.

### Upload / validation rules

- Accepted MIME types: `image/png`, `image/jpeg`, `image/webp`.
- Server-side validation is binary-signature based, not trust-the-browser MIME only.
- Maximum size: **10 MB per file**.
- Maximum count: **4 files per request**.
- Maximum dimensions: **4096 x 4096**.
- Filenames are sanitized server-side; never assume the original client filename is preserved
  byte-for-byte.

### Response shape

`POST /vision/analyze` returns the normal Mora message contract plus the originating user message
id and the analyzed assets:

```json
{
  "conversationId": "uuid",
  "userMessageId": "uuid",
  "messageId": "uuid",
  "response": "Je vois un tableau PostgreSQL...",
  "route": "professional",
  "scope": "professional",
  "space": "code",
  "confidence": 0.95,
  "assets": [
    {
      "id": "uuid",
      "sourceType": "screenshot",
      "originalFilename": "capture.png",
      "summary": "Un tableau PostgreSQL est visible.",
      "extractedText": "PostgreSQL",
      "structuredData": { "topic": "postgresql" },
      "width": 1,
      "height": 1
    }
  ]
}
```

### Conversation semantics

- Omit `conversationId` to start a new multimodal conversation.
- Reuse the returned `conversationId` for follow-up turns, including plain text via
  `POST /messages`.
- The backend persists a bounded `visionContextSummary` on the originating user message so later
  turns can reuse the relevant visual context **without re-uploading every prior image**.
- Vision turns are stored with `channel: "vision"` metadata; `sourceType: "voice_snapshot"`
  upgrades the stored metadata to `channel: "voice_vision"` so the same conversation can drive
  voice + avatar + image UX without a separate pipeline.

### Security / isolation rules

- Images are treated as **untrusted content**. Text seen inside an image is data to read, never a
  system instruction.
- A malicious screenshot saying "ignore previous instructions" must not change route, scope,
  space, permissions, pending-action state, or secret access.
- `scope` / `space` isolation is enforced exactly like text and voice:
  `personal` never sees professional data, and a professional screenshot in `logistiga` stays in
  `professional/logistiga`.
- The backend deliberately overrides routing to the requested `scope` / `space` so a short prompt
  like "Que vois-tu ?" does not accidentally fall back to a `direct` route.

### Error shape / expected failures

- `400` — validation failure (`No image provided`, unsupported image type, oversized file, too
  many images, unsupported professional space, invalid DTO fields).
- `403` / `404` — not your conversation or not your asset.
- `503` — no vision-capable provider configured for that scope/space, or no compatible adapter
  registered for the configured provider.
- Provider-side failures are sanitized before reaching the client; no raw API key or provider
  secret is ever exposed.

### Phase G status

- Targeted unit tests and targeted e2e tests exist for validation, provider resolution,
  conversation continuity, and persisted asset linkage.
- A real provider call still depends on a configured model with actual vision capability; use
  `GET /vision/status` first rather than assuming every chat model can analyze images.

---

## Avatar (Phase H) — STATE, PROFILE, AND FRONTEND CONTRACT

**Core principle: avatar is PRESENTATION STATE, not a second model.** The backend does not run a
separate avatar brain. It exposes deterministic state, expression, and lip-sync payloads derived
from the existing voice + vision + orchestrator pipeline so a frontend can animate Mora
consistently.

### REST endpoints

- `GET /avatar/profile` — returns the caller's avatar profile, creating a default one on first
  read if missing.
- `PATCH /avatar/profile` — updates the caller's avatar preferences.
- `GET /avatar/status` — returns avatar readiness, current profile, optional avatar provider
  resolution, the voice WebSocket path/protocol, and supported realtime events/features.

### `GET /avatar/profile`
- **Auth**: `Authorization: Bearer <accessToken>`
- **Success — 200**:
  ```json
  {
    "id": "uuid",
    "name": "Mora Core",
    "avatarPreset": "mora_core",
    "renderMode": "expressive_orb",
    "baseExpression": "neutral",
    "expressionIntensity": 0.7,
    "lipSyncMode": "viseme_timeline",
    "voiceSyncEnabled": true,
    "idleEnabled": true,
    "reducedMotion": false,
    "settings": { "realtimeTransport": "voice_ws" },
    "createdAt": "2026-09-25T00:10:00.000Z",
    "updatedAt": "2026-09-25T00:10:00.000Z"
  }
  ```

### `PATCH /avatar/profile`
- **Auth**: Bearer token.
- **Body** (all optional):
  ```json
  {
    "name": "Mora Compact",
    "avatarPreset": "mora_core",
    "renderMode": "minimal",
    "baseExpression": "attentive",
    "expressionIntensity": 0.6,
    "lipSyncMode": "viseme_timeline",
    "voiceSyncEnabled": true,
    "idleEnabled": true,
    "reducedMotion": true,
    "settings": { "theme": "dark" }
  }
  ```
- **Success — 200**: same shape as `GET /avatar/profile`.
- **Errors**: `400` (validation), `401`.

### `GET /avatar/status`
- **Auth**: Bearer token.
- **Success — 200**:
  ```json
  {
    "avatarConfigured": true,
    "profile": {
      "id": "uuid",
      "name": "Mora Core",
      "avatarPreset": "mora_core",
      "renderMode": "expressive_orb",
      "baseExpression": "neutral",
      "expressionIntensity": 0.7,
      "lipSyncMode": "viseme_timeline",
      "voiceSyncEnabled": true,
      "idleEnabled": true,
      "reducedMotion": false,
      "settings": { "realtimeTransport": "voice_ws" },
      "createdAt": "2026-09-25T00:10:00.000Z",
      "updatedAt": "2026-09-25T00:10:00.000Z"
    },
    "provider": null,
    "realtime": {
      "websocketPath": "/voice/ws",
      "protocolVersion": 1,
      "events": [
        "avatar.state",
        "assistant.expression",
        "avatar.lipsync",
        "assistant.speaking.started",
        "assistant.speaking.ended",
        "action.pending_confirmation",
        "session.interrupted"
      ]
    },
    "features": {
      "expressions": true,
      "lipSync": true,
      "confirmations": true,
      "reconnectStates": true,
      "multimodalState": true,
      "voiceVision": true
    },
    "privacy": {
      "autoCapture": false,
      "backgroundScreenMonitoring": false,
      "liveCameraRequiresExplicitUserAction": true
    }
  }
  ```

### Rendering and privacy rules

- `renderMode` is frontend presentation state only; the backend does not ship a 3D renderer.
- `lipSyncMode: "viseme_timeline"` is estimated from Mora's response text, not provider phoneme timing.
- `voiceSyncEnabled`, `idleEnabled`, and `reducedMotion` are user preferences the frontend should honor.
- No autonomous camera capture, background screenshotting, or hidden streaming is allowed; avatar
  animation must stay driven by explicit voice/vision actions already authorized by the user.

---

## Endpoints NOT yet available

No endpoint exists (as of Phase H) for: audit entries, conversation rename/delete/title,
pagination cursors, cross-scope toggle, POST/PATCH for profile-facts or entities, a supersede
endpoint, real Google/Microsoft Calendar, real Gmail/Microsoft Graph email, a working Meta
Cloud WhatsApp provider, a browser-rendered 3D avatar scene or asset download endpoint, n8n, a "reveal API key"/"reveal credentials"
endpoint (doesn't exist — by design), a public vision/image/avatar provider-testing endpoint, a
real wake-word detector, continuous screen-sharing/video ingestion, hidden/autonomous capture of
camera or screen frames, and no N3/N4 tool of any kind (the security levels exist and are
enforced, but no phase yet ships a concrete tool at those levels). There is still no public file
download URL for `Document` or `VisionAsset` storage keys.
