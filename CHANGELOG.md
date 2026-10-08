# Changelog

All notable changes to this project are documented here. Dates are in the server's local
timezone (UTC+1).

## [0.1.0] — 2026-10-08

### Security
- Revoked and rotated a Mora API key that had been sitting in plaintext in a local, untracked
  MCP client config (`tools/mcp-whatsapp/claude_desktop_config.json`).
- Added that file to `.gitignore` and replaced it with a secret-free `.example` template, so the
  same key can never be committed by accident going forward.

### Added
- First CI pipeline (`.github/workflows/ci.yml`): lint, typecheck, unit tests and build on every
  push/PR, plus a dedicated e2e job running against ephemeral Postgres(pgvector) + Redis service
  containers.
- This CHANGELOG.

### Changed
- `docs/ARCHITECTURE.md` rewritten to cover the actual current module map (Phases A→I), replacing
  the outdated "Phase A only" document, and corrected to document the real BullMQ usage: memory
  embedding/extraction, conversation summaries, document processing and reminder delivery already
  run as real async jobs (per-module `queue/` folders), each with its own retry/backoff and, for
  documents/reminders, idempotent `jobId`s. An earlier pass of this changelog/doc wrongly claimed
  these ran synchronously — that was based on an incomplete first look at `src/queue/` only (the
  shared connection module) without checking each domain module's own `queue/` subfolder.
- `src/main.ts`: enabled Nest shutdown hooks (`app.enableShutdownHooks()`) so `OnModuleDestroy`
  (BullMQ `QueueEvents` cleanup, and any future queue/worker teardown) runs on SIGTERM instead of
  being killed mid-job when the container is stopped/redeployed.

### Known gaps (tracked, not yet closed)
- Hybrid (personal+professional) requests are split by the LLM and reassembled, never truly
  merged; cross-scope is refused by default (`MORA_CROSS_SCOPE_ENABLED=false`).
- Voice/avatar/lip-sync UX: backend-side fixes are in and covered by automated tests, but final
  human validation in a real browser/microphone has not happened (see `docs/OPEN_ISSUES.md`).
- A failed embedding provider call does not trigger a BullMQ retry today — `EmbeddingService.embed()`
  swallows the error into a logged `EmbeddingOutcome.error` instead of throwing, so the job always
  resolves "successfully" even when no vector was stored. Worth revisiting if silent embedding
  failures turn out to matter in practice.
- No APM/error-tracking (e.g. Sentry) wired in yet; structured JSON logs (pino) are the only
  observability today.
- No documented/automated Postgres backup policy.
