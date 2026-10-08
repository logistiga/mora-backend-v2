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
  the outdated "Phase A only" document. Flagged the BullMQ gap (healthcheck-only queue; memory
  indexing/document extraction/reminders still run synchronously) as the top production-readiness
  risk, with a recommended, safely-staged migration path.

### Known gaps (tracked, not yet closed)
- BullMQ not yet used for real business jobs (see `docs/ARCHITECTURE.md`).
- Hybrid (personal+professional) requests are split by the LLM and reassembled, never truly
  merged; cross-scope is refused by default (`MORA_CROSS_SCOPE_ENABLED=false`).
- Voice/avatar/lip-sync UX: backend-side fixes are in and covered by automated tests, but final
  human validation in a real browser/microphone has not happened (see `docs/OPEN_ISSUES.md`).
