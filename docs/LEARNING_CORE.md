# Learning core — Essential User Profile

Mora can now learn durable, cross-scope user preferences from Chat and Voice and apply them
automatically on future turns — including on the tool-less "direct" route (small talk, general
knowledge), which previously never consulted anything about the user at all.

This document explains what changed, why, and the guarantees/limits of the mechanism. See the
final report (delivered alongside this phase) for root-cause detail, file-by-file changes, and
test results.

## The bug this phase fixes

Real user report: teaching Mora "when I speak Arabic, answer in Arabic; when I speak French,
answer in French" appeared to be acknowledged, but a later "Salam" still got a hardcoded French
reply, and the UI showed "Réponse directe (sans contexte)".

Root cause (confirmed by tracing `message → language detection → router → direct response →
orchestrator → ContextBuilder → memories → ProfileFacts → LLM → response`, and the equivalent
Voice path):

1. `MoraOrchestratorService.handleDirect()` special-cased every greeting with a **100% hardcoded
   French string**, with zero LLM call and zero lookup of anything about the user. "Salam" matches
   the router's `GREETING_PATTERN` and hit exactly this branch.
2. Even a *non*-greeting direct-route message never called `ContextBuilderService` — its system
   prompt explicitly told the model "you have no access to the user's personal or professional
   data here." "No expensive domain retrieval" had, in practice, become "no user context at all."
3. The `ProfileFact` table (the obvious place for this kind of durable preference) was **entirely
   dormant** — nothing in the codebase ever wrote to it. The only thing actually persisted by the
   existing pipeline was the scope-bound `Memory` table via background extraction, which is never
   consulted by the direct route either.
4. The user's exact teaching phrase, "rappelle-toi de...", isn't "rappelle-moi" (which the router
   and the model's tool-choice rules already special-case) and isn't "souviens-toi que"/"retiens
   que" either — genuinely ambiguous to both the router's keyword rules and the model's tool
   choice, so the instruction may not have reliably reached a scope with a write path at all.

None of this needed a single new hardcoded phrase or language rule to fix — it needed the direct
route to stop being memoryless of the user, and a real place to durably store a small, bounded,
cross-scope preference. That's the Essential User Profile.

## What Mora learns automatically

From any **personal or professional** turn (Chat or Voice — same pipeline, see below), a
background extraction pass (`MemoryExtractionService`, reusing the existing pipeline) classifies
what's worth keeping into two buckets:

- **Regular memories** (`Memory` table, existing) — durable facts/preferences/decisions/etc. that
  belong to the *current* scope/space only (e.g. "mon entreprise s'appelle LogistiGA").
- **Essential facts** (`ProfileFact` table, `scope: "essential"`, `space: "essential"` — new use of
  an existing, previously-unused table) — durable preferences meant to apply to **virtually every
  future response**, regardless of scope: language behaviour, form of address, greeting style,
  general response style. Typical keys: `language_behavior`, `form_of_address`, `greeting_style`,
  `response_style` — any short, descriptive `key` is accepted if none of those fit.

The same LLM call proposes both buckets in one response (`{"memories":[...],"essentialFacts":[...]}`)
— see `MemoryExtractionService`'s system prompt for the exact durable-vs-temporary and
scope-bound-vs-essential distinctions given to the model, with worked examples matching this
phase's own test fixtures.

An explicit instruction — "rappelle-toi que...", "souviens-toi que...", "à partir de
maintenant...", "je préfère que...", "remember that...", "from now on...", and a few generic
Arabic/Darija equivalents — is also recognized by the **router** itself
(`LEARNING_INSTRUCTION_PATTERN`) so it never lands on the tool-less "direct" route no matter what
domain keywords it does or doesn't contain, and by the router's LLM fallback prompt for phrasings
the regex doesn't catch. This is deliberately generic: no specific language, and nothing tied to
any one user's phrasing.

## What Mora does NOT learn

- **One-off/temporary instructions** ("réponds-moi en anglais pour ce message", "sois bref cette
  fois") are never persisted — the extraction prompt is explicit about this distinction, with the
  task's own examples embedded as guidance.
- **Contextual, temporary information** ("je suis dans un taxi maintenant") is never persisted.
- **Trivial input** (greetings, thanks, single-word confirmations, anything under ~4 words) never
  even reaches the extraction LLM call (`MemoryExtractionService.isWorthConsidering`) — unchanged
  from before this phase.
- **Secrets.** Any candidate (memory or essential fact) whose content/value looks like a password,
  API key, bearer/access/refresh token, or similar is dropped before it is ever written —
  `src/common/security/secret-patterns.ts` (shared with the existing bug-report sanitizer), plus a
  check that the proposed `key` name itself doesn't name a credential.
- **Anything on the "direct" route.** Small talk / general knowledge never triggers extraction —
  the Essential Profile is *read* on every direct-route turn, never *written* from one.

## Essential User Profile — implementation

- **Storage**: the existing `ProfileFact` table, no new table and **no migration** — `scope` and
  `space` are already plain, unconstrained strings at the DB level (`@@index([userId, scope,
  space, status])` already covers the new sentinel value for free). See `ProfileFactsService`
  (`ESSENTIAL_SCOPE`/`ESSENTIAL_SPACE` constants).
- **Read**: `ProfileFactsService.getEssential(userId)` — one indexed query, `status: 'active'`,
  ordered by confidence, capped at `MORA_ESSENTIAL_PROFILE_LIMIT` (default 12, configurable). No
  embeddings, no LLM call, no per-scope filter. This is deliberately the *only* way anything gets
  into a prompt from this table — never "load everything the user ever said."
- **Write**: `ProfileFactsService.upsertEssential()` — matched and superseded **by key** (exact,
  case-insensitive), not the `Memory` table's content-similarity heuristic: essential facts are
  structured key/value preferences, so an exact-key match is simpler and more reliable, and mirrors
  how a user naturally corrects one specific preference without touching the others. Re-teaching
  the identical value bumps confidence instead of spawning a pointless supersession chain.
- **Correction/supersession**: "finalement, ne fais plus ça" / teaching a new value for an
  existing key marks the old row `status: "superseded"` (never deleted, `supersededById` links to
  the replacement) and the new row becomes `active` — exactly the same pattern already used by
  `Memory`. `ProfileFactsService.archiveEssentialByKey()` is available for an explicit removal.
- **Visibility/user control**: the existing `GET /api/v1/profile-facts` endpoint now also accepts
  `scope=essential&space=essential` (its query DTO whitelist was extended) — no new endpoint, no
  duplicate storage/API surface. There is still no POST/PATCH for profile facts in general (Phase
  C's existing limitation, unchanged); essential facts are currently written only by the
  extraction pipeline.

## Direct-route integration (the actual fix)

`MoraOrchestratorService.handleDirect()` now, for **every** direct-route message including
greetings:

1. Fetches the Essential User Profile (`getEssential`) — cheap, bounded, no LLM.
2. Always calls the LLM (the old 100%-hardcoded greeting shortcut is gone) with a system prompt
   that includes the essential facts (if any) and an instruction to detect the message's language/
   register and honour a stored preference over the default.
3. Only falls back to a fixed string if genuinely no LLM is configured anywhere (env or DB) — and
   even then, makes a best-effort, non-hardcoded attempt via a small generic script/vocabulary
   heuristic (`src/common/language/script-language.util.ts`) rather than silently defaulting to
   French. This heuristic is explicitly a fallback for the *no-LLM* case only; the real mechanism
   is always the model.

`ContextBuilderService` (used by the personal/professional agents) was extended the same way: it
now fetches `getEssential()` in parallel with the existing scope-specific `getRelevant()` facts and
injects both as separate, clearly-labelled sections, budget-respecting like everything else it
assembles.

## Chat / Voice sharing

Voice was already built as a channel of the same assistant, not a second one:
`voice-turn-runner.service.ts` calls the exact same `MoraOrchestratorService.handleMessage()` as
`POST /messages`. This phase adds no new code path for Voice — a preference taught via a voice
turn is written to the same `ProfileFact` row a chat turn would write, and read back by the same
`getEssential()` call regardless of which channel asks. There is no per-channel memory of any
kind, essential or otherwise.

## Scope isolation

Essential facts are **intentionally cross-scope** — that is the entire point of "essential." This
is a different guarantee from `Memory`/scope-specific `ProfileFact` isolation (personal never sees
professional content and vice versa, unchanged and still fully covered by the existing test
suite): an essential fact is a preference about *how Mora communicates*, never a piece of personal
or professional *content*. The extraction prompt's durable-vs-essential classification is what
keeps real scope-bound facts ("mon entreprise s'appelle LogistiGA") out of the essential bucket —
tested explicitly. Structurally, an essential fact also never appears in a scope-specific
`getRelevant(scope, space)` query (it lives at a reserved `scope: "essential"` sentinel a
scope-specific query never matches) — also tested explicitly.

## Security

- Secret-shaped values/keys are rejected before storage (see above) — shared logic with the
  existing bug-report sanitizer, both covered by tests.
- Per-user isolation is unchanged: every read/write goes through `userId`, exactly like every other
  memory/profile-fact/document row in this codebase; a different user's `getEssential()` never
  returns another user's rows (tested).
- No behavioural change to `MORA_CROSS_SCOPE_ENABLED`, hybrid blocking, tool permissions, or
  pending-action confirmation — this phase only touches read/write of a small preference table and
  the direct-route reply path.

## Known limitation (not silently claimed as solved)

The no-LLM fallback's script/vocabulary language heuristic
(`src/common/language/script-language.util.ts`) is generic and intentionally limited — it
recognizes Arabic script, a handful of very common Latin-transliterated Arabic/Darija greeting
words (the same kind of vocabulary the router's own `GREETING_PATTERN` already hardcodes across
several languages), digit-substituted Darija phonemes, and basic French/English stopwords. It is
not a real language model and was not validated against a broad range of real Darija/mixed-language
input — only the exact reported "Salam" fixture and a handful of synthetic cases (see its own unit
tests). This is a documented, best-effort fallback for the *no-LLM-configured* case only; the
primary mechanism (a real LLM call with the Essential Profile in its prompt) does not depend on
this heuristic at all.
