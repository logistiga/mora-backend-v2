import { randomUUID } from 'node:crypto';

export const MAX_REQUEST_ID_LENGTH = 128;

// Letters, digits, `-`, `_`, `.`, `:` only — enough for UUIDs, ULIDs and
// trace ids (`trace:span`), and nothing that could inject into a response
// header, a log line or an HTML view of either.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

export function isSafeRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(value)
  );
}

/**
 * Returns the client-supplied `X-Request-Id` only when it is safe to reflect
 * and log verbatim; anything else (too long, HTML, control characters,
 * repeated header) is discarded — never echoed — and replaced by a fresh
 * server UUID.
 */
export function resolveRequestId(incoming: unknown): string {
  const candidate = typeof incoming === 'string' ? incoming.trim() : undefined;
  return isSafeRequestId(candidate) ? candidate : randomUUID();
}

type RequestIdRequest = { headers: Record<string, string | string[] | undefined> };
type RequestIdResponse = { setHeader(name: string, value: string): unknown };

/**
 * pino-http `genReqId`: resolves the request id, sets the response header,
 * and overwrites a rejected client header in place — the request serializer
 * logs `req.headers` as-is, so the raw value must not survive there either.
 */
export function assignRequestId(req: RequestIdRequest, res: RequestIdResponse): string {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  if (req.headers['x-request-id'] !== undefined) {
    req.headers['x-request-id'] = requestId;
  }
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}
