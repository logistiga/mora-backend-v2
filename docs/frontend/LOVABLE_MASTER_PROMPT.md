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

3. Memory surfaces
- memories list/detail/create/edit/archive
- profile facts read-only
- entities read-only
- conversation summary indicator

4. AI settings
- AI providers list/create/edit/test/enable/disable/set default/delete
- provider status overview

5. Productivity
- tasks
- reminders
- notifications
- pending actions view

6. Documents and connections
- documents upload/list/detail/status
- contacts list/detail/identity linking
- calendar views + free slots
- WhatsApp inbox/account health
- Email inbox/account health

7. Voice + avatar
- voice session UX on `/voice/ws`
- mic / orb / latency overlay
- avatar presenter driven by realtime events
- avatar settings screen using `/avatar/profile`

8. Vision / multimodal
- image upload / camera snapshot / screenshot flow
- `GET /vision/status` preflight
- `POST /vision/analyze`
- compact asset cards in conversation

## UX expectations

- Premium, calm, modern interface.
- Clear personal vs professional separation.
- Strong empty states and degraded states.
- Honest error messages based on backend responses.
- Accessibility first: reduced motion support, keyboard support, good contrast, clear loading states.

## Chat behavior

- `POST /messages` is the default conversation path.
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

## Security and privacy behavior

- Never auto-send email/WhatsApp.
- Never expose hidden storage keys.
- Never imply a fake capability when the backend reports unconfigured status.
- Never silently cross personal/professional boundaries.
- Never run hidden capture in background.

## Implementation bias

- Favor a clean component architecture with reusable badges, cards, panels, and settings forms.
- Centralize API typing from `docs/frontend/TYPES.md`.
- Keep realtime state management explicit and debuggable.
- Prefer graceful degradation over feature hiding when the backend reports partial capability.

## Final constraint

Ship a frontend that feels complete **because it respects the backend truth**. When in doubt,
choose clarity, safety, and consistency over cleverness.
