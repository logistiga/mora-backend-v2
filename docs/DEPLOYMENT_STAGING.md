# Staging deployment

Staging runs on the Logistiga VPS next to (but fully isolated from) Mora v1, n8n, Evolution API
and Traccar. Routing is handled by the host's existing Traefik (`coolify-proxy`, Let's Encrypt
HTTP challenge); nothing about v1 is touched by this deployment.

- Public API: `https://mora-v2-staging.logistiga.tech/api/v1`
- Swagger: `https://mora-v2-staging.logistiga.tech/docs`
- Voice WebSocket: `wss://mora-v2-staging.logistiga.tech/voice/ws?token=<accessToken>`

## Isolation

| Resource  | Staging                                                                  |
| --------- | ------------------------------------------------------------------------ |
| Compose   | project `mora-v2-staging`, file `docker-compose.staging.yml`              |
| Container | `mora-v2-staging-api`, `mora-v2-staging-postgres`, `mora-v2-staging-redis` |
| Network   | `mora-v2-staging-internal` (+ `coolify` for the API, Traefik only)        |
| Volumes   | `mora-v2-staging-postgres-data`, `-redis-data`, `-documents-data`         |

Postgres and Redis publish no host port: the only public entrypoint is Traefik on 443.

## Deploy

```bash
cd /opt/mora-v2-staging
git fetch --all && git checkout <ref> && git pull --ff-only
cp .env.staging.example .env.staging   # first time only, then fill in secrets
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.staging.yml --env-file .env.staging --profile migrate run --rm migrate
```

`migrate` runs `prisma migrate deploy` from the build stage (the runtime image intentionally
ships production dependencies only, without the Prisma CLI).

## Environment

`.env.staging` follows `.env.staging.example`. Two staging-specific flags:

- `MORA_SWAGGER_ENABLED=true` — keeps Swagger served even though `NODE_ENV=production`
  (production shape for logging/build, docs still reachable for the frontend team).
- `CORS_ORIGIN` — comma-separated; an entry containing `*` matches a single subdomain label
  (e.g. `https://*.lovable.app`).

## Debugging a report from the frontend

Every response carries an `x-request-id` header (echoed from the request when the client sends
one), error bodies repeat it as `requestId`, and it is attached to the matching log lines:

```bash
docker logs mora-v2-staging-api | grep <requestId>
```
