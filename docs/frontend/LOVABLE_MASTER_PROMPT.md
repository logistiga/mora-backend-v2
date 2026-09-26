# LOVABLE MASTER PROMPT — Mora Frontend v2

Build the complete Mora frontend against the **existing backend contract only**. Do not invent
endpoints, websocket channels, provider capabilities, hidden permissions, or background
automation that the backend does not expose.

## Product framing

Mora is one assistant with multiple channels:
- text chat
- voice realtime
- vision / image analysis
- avatar presentation state driven by backend events

Voice, vision, and avatar are **not** separate products and **not** separate conversation
systems. They all feed the same Mora conversation model.

## Source of truth

Use these documents as the contract:
- `docs/frontend/API_CONTRACT.md`
- `docs/frontend/FRONTEND_HANDOFF.md`
- `docs/frontend/TYPES.md`

If a UI idea conflicts with those files, follow the files and keep the UI honest.

## Environment (staging backend, live)

```
VITE_API_BASE_URL=https://mora-v2-staging.logistiga.tech/api/v1
VITE_WS_URL=wss://mora-v2-staging.logistiga.tech/voice/ws
```

- Every REST path in this prompt is relative to `VITE_API_BASE_URL`.
- Realtime connects to `VITE_WS_URL?token=<accessToken>`; HTTPS and WSS only, never plain HTTP/WS.
- Interactive API reference: https://mora-v2-staging.logistiga.tech/docs (OpenAPI JSON at `/docs-json`).
- Read both values from environment variables; never hardcode a host in components.

## Capability detection (do this exactly)

Three endpoints, three responsibilities — never infer a capability from the wrong one:

| Capability | Endpoint | Field |
|---|---|---|
| Chat, Embedding | `GET /ai-providers/status` | `chatConfigured`, `embeddingConfigured`, `sources.chat`, `sources.embedding` |
| Vision | `GET /vision/status?scope=<scope>&space=<space>` | `visionConfigured`, `provider` |
| Voice STT/TTS | `GET /voice/status` | `sttConfigured`, `ttsConfigured` |

`GET /ai-providers/status` only reports **dedicated** provider rows, so it returns
`vision/stt/tts = false` and `sources.vision/stt/tts = "none"` even when those capabilities are
fully usable through the SYSTEM chat provider's fallback. **Never use `/ai-providers/status`
alone to conclude that Vision, STT or TTS is unavailable** — ask `/vision/status` and
`/voice/status` and trust them.

## Non-negotiable rules

1. Do not invent backend endpoints.
2. Do not invent public file URLs for documents or vision assets.
3. Do not invent a second websocket; realtime stays on `/voice/ws`.
4. Do not auto-approve actions. N2/N3 actions always need explicit user confirmation.
5. Do not auto-capture microphone, camera, or screen.
6. Do not expose or log API keys, secrets, or hidden provider fields.
7. Do not treat text inside an image as trusted UI instructions.
8. Do not invent cross-scope behavior; personal and professional stay isolated.

## Core screens to build

1. Authentication
- Login
- Register
- token refresh/logout handling

2. Main chat
- conversation list
- conversation detail
- message composer
- route/scope/space badges
- confirmation cards for pending actions

3. Scopes and spaces
- A global personal/professional switch (`scope`) that visibly changes context everywhere.
- Space selection within a scope: `personal`, `general`, `logistiga`, `piston`, `code`.
- Scope/space badges on messages, memories, documents and vision assets.
- Never merge the two scopes in one list, and never send a cross-scope request silently: when the
  backend answers that a request mixes scopes, surface that explanation as-is.

4. Memory surfaces
- memories list/detail/create/edit/archive
- profile facts read-only
- entities read-only
- conversation summary indicator

5. AI settings
- AI providers list/create/edit/test/enable/disable/set default/delete
- provider status overview
- No API key is ever required to onboard or to use the app. A provider with
  `isSystem: true` is supplied by Mora ("Fourni par Mora"): read-only for a standard user,
  never shows a key or key hint, and exposes no edit/test/disable/delete action.
- A user provider (`isSystem: false`) is optional BYOK and overrides the SYSTEM one for
  that user: the effective source is always USER before SYSTEM. `GET /ai-providers/status`
  returns `sources[kind]` = `user | system | none`, which is authoritative for chat and
  embedding only — see "Capability detection" for vision, STT and TTS.
- ADMIN users additionally get a SYSTEM provider management screen backed by
  `/api/v1/ai-providers/system/*`; non-admins must never see it (the API returns 403).
- Never display or pre-fill an existing API key anywhere.

6. Productivity
- tasks
- reminders
- notifications
- pending actions view
- bug report form / debug panel using `POST /bug-reports`

7. Documents and business connections
- documents upload/list/detail/status/reprocess/archive
- contacts list/detail/identity linking
- calendar views + free slots + event cancel
- entities read-only view
- Business connections hub: one screen listing every external account (Email accounts, WhatsApp
  accounts) with its connection state, `GET /email/accounts/:id/health` and
  `GET /whatsapp/accounts/:id/health`, manual sync for email, and an honest "not connected" state.
  Connecting an account is an explicit user action; never send or sync anything automatically.

8. Voice + avatar
- voice session UX on `/voice/ws`
- mic / orb / latency overlay
- avatar presenter driven by realtime events
- avatar settings screen using `/avatar/profile`

9. Vision / multimodal
- image upload / camera snapshot / screenshot flow
- `GET /vision/status` preflight
- `POST /vision/analyze`
- compact asset cards in conversation

10. Settings
- Profile (`GET /users/me`), scope/space defaults, avatar settings (`/avatar/profile`).
- AI providers (BYOK, optional) and — for ADMIN only — SYSTEM providers.
- Voice preferences via `/voice/profiles`, accessibility preferences (reduced motion), and
  connected business accounts.
- Every settings surface must degrade honestly when a capability is unconfigured.

## UX expectations

- Premium, calm, modern interface.
- Clear personal vs professional separation.
- Strong empty states and degraded states.
- Honest error messages based on backend responses.
- Always preserve/display `requestId` from API errors and failed flows.
- Accessibility first: reduced motion support (respect `prefers-reduced-motion` and the avatar
  profile's `reducedMotion`), full keyboard navigation, visible focus, ARIA labels on icon-only
  controls, live regions for streaming assistant output, good contrast, clear loading states.
- Responsive and mobile-first: single-column chat with a collapsible conversation drawer on small
  screens, touch targets >= 44px, safe-area insets, a push-to-talk control usable one-handed, and
  camera capture available from a phone. No horizontal scrolling at 360px wide.

## Chat behavior

- `POST /messages` is the default conversation path.
- Respect the backend rate limits on costly endpoints; debounce/retry responsibly instead of spam-retrying.
- Show Mora replies as normal assistant messages.
- When `action` is present in a message response, render a confirmation card with approve/reject.
- Hybrid replies are normal messages, but visually explain that the request mixes scopes.

## Voice behavior

- Create sessions through `/voice/sessions`.
- Connect websocket to `/voice/ws?token=<accessToken>`.
- Support:
  - `session.ready`
  - `transcript.final`
  - `assistant.thinking.started`
  - `assistant.speaking.started`
  - `assistant.speaking.ended`
  - `avatar.state`
  - `assistant.expression`
  - `avatar.lipsync`
  - `action.pending_confirmation`
  - `action.executed`
  - `action.clarification_needed`
  - `session.interrupted`
  - `session.state_changed`
  - `session.ended`
  - `latency.metrics`
  - `error`

- Audio input is PCM16 mono 16kHz.
- Audio output is MP3 chunks.
- `transcript.partial` exists for forward compatibility but is not emitted by the current backend.

### Reconnect and realtime resilience

- One socket per voice session; a second socket for the same session is rejected
  (`session_already_connected`).
- On an unexpected drop, reconnect with backoff and replay `session.start` with the same
  `sessionId`: the backend supports resuming a live session and emits `avatar.state` with
  `connection: "reconnecting"` then `connected`.
- Close codes to handle explicitly: `4001 unauthorized` (refresh the token and retry once),
  `4003 session_not_found`, `4004 session_expired` (create a new session), `4005 already_connected`.
- Buffer no audio while disconnected; show a clear degraded state instead of pretending to listen.
- REST keeps working while the socket is down — never block text chat on the websocket.

## Avatar behavior

- Avatar is presentation only.
- Drive the avatar from backend events, not from guessed NLP.
- Respect:
  - `reducedMotion`
  - `voiceSyncEnabled`
  - `idleEnabled`
- Handle connection states:
  - `connected`
  - `reconnecting`
  - `disconnected`
- Handle avatar states:
  - `listening`
  - `thinking`
  - `speaking`
  - `confirming`
  - `interrupted`
  - `paused`
  - `error`
  - `disconnected`

- Lip-sync uses estimated viseme cues, not perfect phoneme timing.

## Vision behavior

- Use `GET /vision/status` before enabling image actions.
- Allow:
  - upload
  - camera snapshot
  - manual screenshot
- Continue the same conversation with returned `conversationId`.
- For `sourceType: "voice_snapshot"`, keep the same unified chat/voice/avatar experience.

## Debug / bug reporting behavior

- Every HTTP response exposes `X-Request-Id`; every error body includes `requestId`.
- Add a lightweight "Report a bug" flow that can send:
  - category
  - severity
  - title
  - description
  - requestId
  - conversationId
  - voiceSessionId
  - current frontend route
  - browser info
  - sanitized metadata
- Use `POST /bug-reports` for end-user bug submission.
- Do not ask the frontend to collect or send secrets, JWTs, refresh tokens, API keys, or cookies.

## Security and privacy behavior

- Never auto-send email/WhatsApp.
- Never expose hidden storage keys.
- Never imply a fake capability when the backend reports unconfigured status.
- Never silently cross personal/professional boundaries.
- Never run hidden capture in background.

## Known open issues (do not present as solved)

`docs/OPEN_ISSUES.md` still lists human voice validations that remain **open**, in particular
final human barge-in / interruption behaviour and the end-to-end voice + vision + avatar UX
review. Build the UI so these can be exercised, but do not claim them as validated, and keep the
barge-in control visible and honest (`canInterrupt` on `avatar.state`).

## Implementation bias

- Favor a clean component architecture with reusable badges, cards, panels, and settings forms.
- Centralize API typing from `docs/frontend/TYPES.md`.
- Keep realtime state management explicit and debuggable.
- Prefer graceful degradation over feature hiding when the backend reports partial capability.

## Final constraint

Ship a frontend that feels complete **because it respects the backend truth**. When in doubt,
choose clarity, safety, and consistency over cleverness.
