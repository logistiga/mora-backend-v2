# Staging Deployment

## Objective

Deploy Mora Backend v2 staging as an isolated stack, without reusing Mora v1 database, Redis,
or storage volumes.

## Isolation rules

- dedicated Docker project name
- dedicated Docker network
- dedicated PostgreSQL container and volume
- dedicated Redis container and volume
- dedicated documents/uploads volumes
- no reuse of Mora v1 volumes
- no reuse of Mora v1 database
- no reuse of Mora v1 Redis

## Recommended naming

- project: `mora-v2-staging`
- api: `mora-v2-staging-api`
- postgres: `mora-v2-staging-postgres`
- redis: `mora-v2-staging-redis`
- network: `mora-v2-staging-network`
- volumes:
  - `mora-v2-staging-postgres-data`
  - `mora-v2-staging-redis-data`
  - `mora-v2-staging-documents`
  - `mora-v2-staging-uploads`

## Required environment principles

- `NODE_ENV=production`
- `MORA_APP_ENV=staging`
- `MORA_ALLOWED_ORIGINS=<comma-separated allowlist>`
- `MORA_BUILD_VERSION=<build identifier>`
- `MORA_GIT_COMMIT=<git sha>`
- strong dedicated staging secrets for:
  - JWT access
  - JWT refresh
  - encryption key
  - PostgreSQL
  - Redis if enabled

## Reverse proxy expectations

- reuse the existing reverse proxy stack if possible
- HTTPS required
- WSS required for `/voice/ws`
- correct proxy headers
- upload limit high enough for document/vision test payloads
- voice-friendly timeouts

## Database

- use `prisma migrate deploy`
- never use `prisma migrate dev` on staging
- verify with `prisma migrate status`
- verify `pgvector` is available before vision/memory validation

## AI provider configuration

- configure chat, embedding, and vision through the existing AI Provider Manager
- do not copy encrypted provider ciphertext across environments with a different encryption key
- only use the normal encrypted write path

## Smoke validation after deploy

Minimum checks:

1. `GET /api/v1/health`
2. auth register/login/refresh/logout
3. `POST /messages`
4. `GET /ai-providers/status`
5. `GET /vision/status`
6. `GET /avatar/status`
7. `POST /bug-reports`
8. `/voice/ws` handshake over WSS

## Public values for frontend consumers

- `VITE_API_BASE_URL`
- `VITE_WS_URL`
- optional Swagger/docs URL if exposed in staging

Never publish:

- provider secrets
- JWT secrets
- DB credentials
- Redis credentials
