# API Contract — Mora Backend v2 (Phase A + Phase B)

Base URL (local dev): `http://localhost:3000/api/v1`
All request/response bodies are JSON. Auth is JWT Bearer unless stated otherwise.

**Global error shape** (from `AllExceptionsFilter`, applies to every endpoint below):
```json
{
  "statusCode": 401,
  "timestamp": "2026-09-22T13:00:00.000Z",
  "path": "/api/v1/users/me",
  "method": "GET",
  "message": "Unauthorized"
}
```
`message` can be a string or a string array (validation errors return an array, one entry
per failed field).

**Rate limiting**: global default 100 requests / 60s per client (env-configurable); `POST
/auth/login` is stricter: 5 requests / 60s. A throttled request returns `429`.

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
    "details": { "postgres": { "status": "up" }, "redis": { "status": "up" } }
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

## Endpoints NOT yet available

No endpoint exists (as of Phase B) for: audit entries, LLM configuration status/selection,
conversation rename/delete, pagination cursors, cross-scope toggle, memory/embeddings,
documents, tools/actions, WhatsApp/email/calendar, voice, avatar.
