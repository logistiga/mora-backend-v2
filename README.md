# Mora Backend v2

Backend for Mora, a personal AI assistant platform — built from scratch, fully separate from
[mora-s-hub](https://github.com/logistiga/mora-s-hub) (v1, unaffected by this repo).

**Phase A — Core Foundation** is implemented here: no LLM, memory, embeddings, agents,
WhatsApp/email, voice or avatar yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what comes next
and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical decisions behind this phase.

## Stack

TypeScript · NestJS · PostgreSQL (+ pgvector, unused until Phase C) · Prisma ORM (driver-adapter
mode) · Redis · BullMQ · Docker / Docker Compose · REST API · Vitest.

## Getting started

### 1. Prerequisites

- Node.js 22+
- Docker Desktop (for Postgres/Redis locally)

### 2. Configure environment

```bash
cp .env.example .env
# edit .env: set real secrets for JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (32+ chars each)
```

### 3. Start Postgres + Redis (and optionally the API) via Docker

```bash
npm run docker:up          # mora-postgres, mora-redis, mora-api (dev override hot-reloads from ./src)
npm run docker:logs        # tail logs
npm run docker:down        # stop
```

Postgres and Redis ports are only published to the host through
`docker-compose.override.yml` (local dev convenience) — the base `docker-compose.yml`
alone (as used in production) keeps them internal to the `mora-internal` network.

### 4. Database

```bash
npm run prisma:generate        # regenerate the Prisma client after a schema change
npm run prisma:migrate:dev     # apply migrations locally (creates a new one if the schema changed)
npm run prisma:seed            # insert a synthetic dev user (dev.user@example.test)
```

### 5. Run the API without Docker

```bash
npm install --legacy-peer-deps   # see "Known issues" below
npm run start:dev
```

- REST API: `http://localhost:3000/api/v1`
- Health check: `GET http://localhost:3000/api/v1/health`
- Swagger (non-production only): `http://localhost:3000/docs`

### 6. Tests

```bash
npm run test         # unit tests (no external services needed)
npm run test:e2e      # integration tests — needs Postgres + Redis running (npm run docker:up)
npm run test:cov      # coverage
```

## Project layout

```
src/
  config/     # env validation (class-validator) + typed configuration
  database/   # PrismaService (Prisma 7 driver-adapter client)
  auth/       # JWT access/refresh, guards, strategies
  users/      # User model access
  health/     # GET /api/v1/health (Postgres + Redis)
  common/     # global exception filter, decorators
  queue/      # BullMQ setup + a healthcheck-only job
prisma/       # schema, migrations, seed
docker/       # postgres init scripts (pgvector extension)
docs/         # architecture + roadmap
```

## Known issues / environment notes

- **npm install**: a plain `npm install` currently fails with `Cannot read properties of null
  (reading 'edgesOut')`, an npm/arborist peer-dependency resolution bug triggered by this
  dependency set. Use `npm install --legacy-peer-deps` instead (already the case in the
  Dockerfile).
- **ESM**: the project uses `"type": "module"`; relative imports need explicit `.js` extensions
  (TypeScript `moduleResolution: nodenext`), and this is why you'll see `import ... from
  './foo.js'` even though the source file is `foo.ts`.
- **Prisma 7**: connection URLs are no longer declared in `schema.prisma`; the client is
  constructed with a `@prisma/adapter-pg` driver adapter (see `src/database/prisma.service.ts`)
  and `prisma.config.ts` holds the URL for the CLI (migrate/studio).

## Security defaults

- Helmet, configurable CORS, global `ValidationPipe` (whitelist + forbid unknown fields), global
  rate limiting (`@nestjs/throttler`, stricter on `/auth/login`).
- Passwords hashed with bcrypt (12 rounds); refresh tokens are hashed before being stored and
  rotated on every use.
- No secrets committed — `.env` is git-ignored, `.env.example` documents the shape.
