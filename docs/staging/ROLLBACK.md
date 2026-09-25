# Staging Rollback

## Goal

Rollback Mora v2 staging without touching Mora v1 or any other existing service.

## Golden rule

Rollback must operate only on the dedicated staging stack:

- staging containers
- staging network
- staging volumes created for Mora v2 staging only
- staging reverse-proxy route only

Never:

- delete Mora v1 containers
- delete Mora v1 volumes
- modify Mora v1 database
- modify n8n / Evolution / Traccar data

## Fast rollback path

1. identify the currently deployed staging git commit
2. stop only the staging API/worker/scheduler containers
3. restore the previous known-good staging image or checkout
4. restart only the staging stack
5. verify:
   - `/health`
   - auth
   - `/messages`
   - `/vision/status`
   - `/avatar/status`
   - `/voice/status`
   - WSS handshake

## Database rollback policy

- prefer forward-fix over destructive database rollback
- if a migration is already applied on staging, do not improvise a destructive reverse migration
- if rollback needs schema compatibility, redeploy the last application version compatible with
  the current staging schema, or create an explicit safe follow-up migration

## Reverse proxy rollback

- keep a backup of the modified proxy configuration before changing staging routing
- if the new staging route fails, restore only the previous staging-related proxy fragment
- do not alter unrelated domains

## Provider rollback

- if a staging AI provider configuration is invalid, disable or replace only the staging provider rows
- never copy encrypted provider secrets between environments with different encryption keys

## Evidence to keep

Before rollback, preserve:

- failing `requestId`
- relevant `bug_reports` rows
- relevant `llm_calls`
- queue logs with matching `requestId`
- `voiceSessionId` / `connectionId` when voice was involved

## Success criteria after rollback

- staging responds again over HTTPS
- WSS handshake works
- existing non-staging services are unchanged
- working tree / Git history for the release branch remain understandable
