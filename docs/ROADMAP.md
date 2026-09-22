# Roadmap

Phase A (this repo, current state) is the only phase implemented. Everything below is planned,
not built — listed here so scope stays explicit and Phase A isn't quietly expanded.

## Phase A — Core Foundation ✅ (current)
NestJS + TypeScript strict, PostgreSQL + pgvector (extension enabled, unused), Prisma, Redis,
BullMQ (healthcheck job only), JWT access/refresh auth, `/health`, structured logging, global
exception handling/validation/rate limiting, Swagger (dev), Docker Compose, tests.

## Phase B — Router + PersonalAgent + ProfessionalAgent
`MoraRouter` dispatches a request to `PersonalAgent`, `ProfessionalAgent`, or a `Hybrid` mode only
when explicitly authorized by the user. No LLM calls yet — this phase is about the routing
contract and agent boundary, not intelligence.

## Phase C — Mémoire + pgvector + embeddings
`MemoryService`, `MemoryRetrievalService`, `EmbeddingService`. First real use of the `vector`
column type enabled in Phase A. Defines how personal vs. professional memory stay separated.

## Phase D — Agent + outils + permissions
`ToolService`, `PermissionService`, `AuditService`. Tool-calling framework with an explicit
permission model — what an agent may do on a user's behalf, and an audit trail of what it did.

## Phase E — Documents + tâches + rappels
Document ingestion/storage, task tracking, reminders — the first user-facing productivity
features built on top of Phases B–D.

## Phase F — WhatsApp + email + calendrier + APIs métiers
External channel integrations (WhatsApp, email) and calendar/business-API connectors, gated by
the Phase D permission model.

## Phase G — Voix temps réel + reconnaissance vocale
Real-time voice: speech-to-text, text-to-speech, streaming over the SSE/WebSocket transport
scaffolded (but unused) in Phase A.

## Phase H — Avatar 3D + émotions
Visual embodiment layer: 3D avatar rendering and emotion expression tied to conversation state.

---

**Explicitly out of scope for Phase A**: LLM calls, memory, embeddings, agents, WhatsApp, email,
voice, avatar. None of the transversal services above (`ContextBuilder`, `MemoryService`,
`MemoryRetrievalService`, `EmbeddingService`, `LlmService`, `ToolService`, `PermissionService`,
`AuditService`) are implemented yet — only the foundation they'll eventually sit on.
