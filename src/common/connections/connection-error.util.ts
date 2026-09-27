/**
 * Connection health checks talk to third-party servers (IMAP/SMTP, Evolution)
 * whose raw failure messages routinely embed internals the client must never
 * receive: the host and port we dial, the username or mailbox we authenticate
 * with, the instance id, the provider's own banner text, and occasionally a
 * node stack frame. Those messages are surfaced verbatim in
 * `GET .../accounts/:id/health` and persisted in `last_error`.
 *
 * Health only needs to tell the user WHICH kind of problem to act on, so the
 * raw text is mapped to a closed set of codes and nothing else is returned.
 */
export const CONNECTION_ERROR_CODES = [
  'auth_failed',
  'host_unreachable',
  'tls_error',
  'timeout',
  'rejected_by_provider',
  'unknown_error',
] as const;

export type ConnectionErrorCode = (typeof CONNECTION_ERROR_CODES)[number];

export function classifyConnectionError(error: unknown): ConnectionErrorCode {
  const raw = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!raw) return 'unknown_error';

  if (/auth|credential|password|login|invalid user|535|534|authenticationfailed/.test(raw)) return 'auth_failed';
  if (/timeout|timed out|etimedout/.test(raw)) return 'timeout';
  if (/certificate|tls|ssl|self.signed|handshake/.test(raw)) return 'tls_error';
  if (/enotfound|econnrefused|ehostunreach|enetunreach|dns|getaddrinfo|econnreset/.test(raw)) return 'host_unreachable';
  if (/status [45]\d\d|forbidden|unauthorized|bad request/.test(raw)) return 'rejected_by_provider';
  return 'unknown_error';
}
