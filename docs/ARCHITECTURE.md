# Architecture — Phases A→I (current state)

## Scope

This document used to cover only Phase A. It now tracks the whole backend as implemented; for
remaining work see [`ROADMAP.md`](ROADMAP.md) and [`OPEN_ISSUES.md`](OPEN_ISSUES.md).

## Module map

```
AppModule
├─ ConfigModule           (global) — env validation + typed config
├─ LoggerModule            (nestjs-pino) — structured JSON logs, pretty-printed in dev
├─ ThrottlerModule          — global rate limiting
├─ DatabaseModule          (global) — PrismaService
├─ QueueModule             — BullMQ connection + healthcheck queue/worker (see "BullMQ" below)
├─ HealthModule             — GET /health (Postgres + Redis)
├─ AuthModule               — login/refresh/logout + personal API keys (auth/api-keys)
├─ UsersModule              — GET /users/me
├─ RouterModule             — MoraRouter: classifies personal / professional / hybrid / direct
├─ AgentsModule             — PersonalAgent, ProfessionalAgent
├─ ContextModule            — reconstructs per-turn context (memory, profile, history)
├─ OrchestratorModule       — drives a turn end-to-end across the agents above
├─ LlmModule / AiProvidersModule — provider selection per scope/space, SYSTEM or BYOK keys
├─ MemoryModule / EmbeddingModule — long-term memory, profile facts, summaries, pgvector search
├─ ToolsModule / AuditModule / PendingActionsModule — tool registry, execution, confirmation flow
├─ DocumentsModule / TasksModule / RemindersModule / NotificationsModule
├─ WhatsAppModule / EmailModule / CalendarModule / GoogleModule / ContactsModule
├─ BusinessConnectorsModule / McpModule
├─ VoiceModule              — STT/TTS, streaming, barge-in, stale-turn cancellation
├─ VisionModule / AvatarModule — snapshot vision, avatar profile/state/lip-sync events
└─ SkillsModule             — per-user tool-group enable/disable, enforced in 3 places
```

Global providers (via `APP_GUARD` / `APP_FILTER` / `APP_PIPE`): `ThrottlerGuard`,
`AllExceptionsFilter`, `ValidationPipe`.

## Why these choices

### Prisma over TypeORM
Declarative migrations, strong TypeScript inference, and — critically for the roadmap — a clean
path to `pgvector` columns via `Unsupported`/native vector types once Phase C needs embeddings.
Prisma 7 changed how the client connects: `schema.prisma` no longer holds a `url`; instead
`PrismaService` builds the client with a `@prisma/adapter-pg` driver adapter, and
`prisma.config.ts` supplies the URL to the CLI (`migrate`, `studio`).

### pgvector from day one, unused
`docker/postgres/init-pgvector.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` on first
container start. The Prisma schema declares `extensions = [vector]` (via the
`postgresqlExtensions` preview feature) so `prisma migrate` is aware of it. No model uses a
`vector` column yet — that's Phase C.

### JWT access + refresh, stored server-side
- Access tokens are short-lived (`JWT_ACCESS_EXPIRES_IN`, default 15m), stateless, verified by
  `JwtAccessStrategy`/`JwtAccessGuard`.
- Refresh tokens are longer-lived (default 7d) but **not** purely stateless: each issuance creates
  a `RefreshToken` row (`prisma/schema.prisma`) keyed by a `jti`, with the token itself stored only
  as a bcrypt hash. `POST /auth/refresh` verifies the presented token against that hash, revokes
  it, and issues a new pair (rotation) — so a stolen-then-replayed refresh token is a single-use
  liability, not a standing backdoor.
- Two separate secrets (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`) so leaking one doesn't
  compromise the other token type.

### BullMQ: healthcheck job only — known gap
`QueueModule` wires a BullMQ connection to Redis and registers one queue (`healthcheck`) with a
trivial processor. This exists to prove the Redis/BullMQ plumbing works. Despite later phases
(memory indexing, document fact extraction, reminders, notification delivery) being fully
implemented, **none of that work actually runs through BullMQ today** — it executes synchronously
inside the HTTP request/response cycle or inline in whichever service triggers it. This is the
single largest production-readiness gap in the backend:
- No retry-with-backoff on a failed embedding call or document parse — it just fails the request.
- A slow LLM/embedding provider directly extends HTTP latency instead of being decoupled.
- No visibility into queue depth/backlog for these workloads, because they never enter a queue.

Recommended follow-up (not yet done, deliberately — moving this safely needs its own
test-and-verify pass against the e2e suite, which this delivery could not run locally): add real
queues/processors for memory indexing and document extraction first (the two most latency-
sensitive paths), keeping the synchronous path as a fallback behind a feature flag until the e2e
suite is green against the new async flow.

### Structured logging
`nestjs-pino` replaces Nest's default logger app-wide (`app.useLogger`), producing JSON logs in
non-dev environments (pretty-printed via `pino-pretty` locally) with request correlation and
`Authorization` header redaction.

### Global exception handling & validation
`AllExceptionsFilter` normalizes every uncaught error (HTTP or not) into a consistent JSON shape
(`statusCode`, `timestamp`, `path`, `method`, `message`) and logs 5xx with a stack trace. The
global `ValidationPipe` rejects any request body field not declared on its DTO
(`forbidNonWhitelisted`).

### Rate limiting
Global default from `THROTTLE_TTL`/`THROTTLE_LIMIT` (env-configured), with `POST /auth/login`
overridden to a stricter 5 requests / 60s via `@Throttle()` — it's the highest-value brute-force
target in this phase.

### Swagger — dev only
Mounted at `/docs` only when `NODE_ENV !== 'production'` (`src/main.ts`), so the API surface isn't
exposed publicly in prod.

## Data model (Phase A)

```
User
  id            UUID (pk)
  email         unique
  passwordHash  bcrypt, never serialized (UserEntity excludes it)
  displayName
  role          USER | ADMIN
  isActive
  createdAt / updatedAt

RefreshToken
  id            UUID (pk) — also the JWT "jti" claim
  tokenHash     bcrypt hash of the issued refresh JWT
  userId        -> User, cascade delete
  revokedAt     nullable — set on rotation/logout
  expiresAt
```

## Docker layout

- `Dockerfile`: multi-stage (`deps` → `build` → `prod-deps` → `runtime`), non-root user, only
  `dist/`, production `node_modules`, and `prisma/` copied into the final image.
- `docker-compose.yml`: production-shaped base — `mora-postgres` (pgvector/pgvector:pg16),
  `mora-redis`, `mora-api`; Postgres/Redis are **not** published to the host.
- `docker-compose.override.yml`: local-dev only (auto-loaded by `docker compose up`) — publishes
  DB/Redis ports to the host and runs the API in watch mode with a bind-mounted `src/`.

## Learning core — Essential User Profile

Durable, cross-scope user preferences (language behaviour, form of address, greeting/response
style) learned from Chat/Voice and applied automatically to every future turn, including the
tool-less "direct" route. Reuses the existing (previously unused) `ProfileFact` table with a
reserved `scope: "essential"` sentinel — no migration. See **[docs/LEARNING_CORE.md](LEARNING_CORE.md)**
for the full design, the root-cause bug it fixes, and its guarantees/limits.

## Environment & secrets

Every variable the app reads is declared and validated in `src/config/env.validation.ts`
(`class-validator`-based). Startup fails fast — before the HTTP listener opens — if anything is
missing, wrongly typed, or (for JWT secrets) too short. `.env.example` documents every key;
`.env` itself is git-ignored.

## Skills registry

A **skill** is a named group of tools a user can switch on or off (Mémoire, Tâches,
Rappels, WhatsApp, Email, Agenda, LogistiGA, Piston...). The catalog lives in code
(`src/skills/skill-catalog.ts`); the table `user_skills` stores only deviations from the
default. A missing row means **enabled**, so no backfill is needed and existing users keep
today's behaviour.

- Every registered tool must belong to exactly one skill. A tool that belongs to no skill
  is never gated, and the e2e suite (`test/skills.e2e-spec.ts`) fails if a new tool is added
  without a skill.
- Enforcement happens in three places: the LLM never sees tools of a disabled skill
  (`ToolRegistryService.toLlmToolDefinitions`), `ToolExecutorService.requestExecution`
  rejects with `skill_disabled`, and `PendingActionService.approve` refuses to run a
  confirmed action whose skill was disabled after it was proposed.
- API: `GET /api/v1/skills`, `PATCH /api/v1/skills/:key` with body `{ "enabled": boolean }`.
  The body must be a real JSON boolean: the string `"false"` is rejected, because the
  app-wide ValidationPipe uses implicit conversion.

## Google integration (Calendar)

One Google OAuth grant per user, stored in `google_accounts` with the refresh token encrypted
(AES-256-GCM, same service as provider secrets). Access tokens live in memory only.

- `POST /api/v1/google/oauth/authorize` returns the consent URL. `GET /api/v1/google/oauth/callback`
  is public by design: the HMAC-signed, 10-minute `state` binds it to the user who started it.
- `GET /api/v1/google/status`, `DELETE /api/v1/google/account` (revokes at Google, then deletes).
- The calendar backend is chosen per user by the `calendar` skill config: `provider` is `mora`
  (default, internal) or `google`. Switching is explicit, so existing agenda data is never moved.
- Google-created events from Mora carry `mora_scope` / `mora_space` as private properties, so
  scope isolation holds on the way back. Events created directly in Google have no label and show
  up in every listing of their user.
- Configuration: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.
  Optional at boot; the authorize endpoint answers 503 until they are set.
- Not yet built: Gmail and Google Docs on this same grant, and live validation against Google.

## Gmail

A Gmail mailbox is an ordinary `email_accounts` row with `provider: 'gmail'`, created by
`POST /api/v1/google/gmail/account` once a Google grant exists. It carries no credentials of
its own: `EmailProviderRouter` sends it to `GoogleGmailEmailProvider`, which uses the user's
Google token (`gmail.readonly` + `gmail.send`). Every other mailbox stays on IMAP/SMTP.
Users connected before this change must reconnect once to grant the Gmail scopes.
