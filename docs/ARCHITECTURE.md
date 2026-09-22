# Architecture — Phase A (Core Foundation)

## Scope

This document covers only what exists today. For what's planned, see [`ROADMAP.md`](ROADMAP.md).

## Module map

```
AppModule
├─ ConfigModule        (global) — env validation + typed config
├─ LoggerModule         (nestjs-pino) — structured JSON logs, pretty-printed in dev
├─ ThrottlerModule       — global rate limiting
├─ DatabaseModule       (global) — PrismaService
├─ QueueModule          — BullMQ connection + healthcheck queue/worker
├─ HealthModule          — GET /health (Postgres + Redis)
├─ AuthModule            — register/login/refresh/logout
└─ UsersModule           — GET /users/me
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

### BullMQ: healthcheck job only
`QueueModule` wires a BullMQ connection to Redis and registers one queue (`healthcheck`) with a
trivial processor. This exists purely to prove the Redis/BullMQ plumbing works — no business logic
runs through it yet. Real job types (memory indexing, tool execution, reminders, ...) arrive in
later phases.

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

## Environment & secrets

Every variable the app reads is declared and validated in `src/config/env.validation.ts`
(`class-validator`-based). Startup fails fast — before the HTTP listener opens — if anything is
missing, wrongly typed, or (for JWT secrets) too short. `.env.example` documents every key;
`.env` itself is git-ignored.
