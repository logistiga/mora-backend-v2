# Staging Debugging

## Goal

Provide one repeatable path from a frontend-visible bug to the correlated backend evidence,
without exposing secrets.

## Core identifiers

- `X-Request-Id`: present on every HTTP response.
- `requestId`: present in every JSON error body.
- `conversationId`: returned by chat/vision flows.
- `voiceSessionId`: returned by voice session creation and usable for voice/avatar correlation.

## Standard frontend bug workflow

1. Capture the failing screen and the exact action.
2. Copy the `requestId` from the failing API response.
3. If the issue happened in chat/vision/voice, also capture:
   - `conversationId`
   - `voiceSessionId` when applicable
4. Create `POST /api/v1/bug-reports` with:
   - category
   - severity
   - title
   - description
   - requestId
   - conversationId if known
   - voiceSessionId if known
   - current frontend route
   - browser info
   - sanitized metadata only

## Backend correlation path

### HTTP

- Search structured logs by `requestId`.
- Confirm:
  - route
  - status code
  - duration
  - userId
  - scope / space when available

### Exceptions

- Error responses never expose stack traces to the frontend.
- Backend logs keep the correlated failure with the same `requestId`.

### BullMQ

- Queue producers now propagate `requestId` into memory/document/reminder jobs.
- Processor logs include:
  - `requestId`
  - queue job id
  - business id (`documentId`, `sourceMessageId`, `reminderId`)

### Voice / WebSocket

- Use `voiceSessionId` first.
- Gateway debug events also emit a server-side `connectionId` for handshake/reconnect tracing.
- Correlate:
  - `voiceSessionId`
  - `connectionId`
  - `conversationId`
  - avatar realtime events

### LLM / providers

- `llm_calls` rows now carry `requestId` when the request originated from HTTP.
- Use `requestId` + `userId` + `createdAt` to connect:
  - frontend failure
  - backend request log
  - provider latency / error
  - route / scope / space

## What must never be logged or reported

- `Authorization`
- JWT / refresh token
- password
- API key
- provider secret
- raw audio
- raw private image
- full private document payload

## Minimal operator checklist

When a bug is reported:

1. find the `bug_reports` row
2. extract `requestId`
3. search HTTP logs for that `requestId`
4. inspect related `llm_calls`
5. inspect queue logs with the same `requestId`
6. inspect `voiceSessionId` / `connectionId` if voice was involved
7. confirm whether the bug is frontend-only, backend-only, provider-related, or mixed
