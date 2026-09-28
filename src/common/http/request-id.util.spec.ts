import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEST_ID_LENGTH,
  assignRequestId,
  isSafeRequestId,
  resolveRequestId,
} from './request-id.util.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(header: string | string[] | undefined) {
  const req = { headers: { 'x-request-id': header } as Record<string, string | string[] | undefined> };
  const set: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (set[name] = value) };
  const id = assignRequestId(req, res);
  return { id, loggedHeader: req.headers['x-request-id'], responseHeader: set['X-Request-Id'] };
}

describe('request id', () => {
  it.each([
    'req-bug-e2e-2',
    '8f2883c4-2f0b-43b4-820a-c5d43112a101',
    '01J9ZK3X7Q_trace.span:42',
    'a'.repeat(MAX_REQUEST_ID_LENGTH),
  ])('keeps a safe client id %s', (value) => {
    expect(resolveRequestId(value)).toBe(value);
    const { id, loggedHeader, responseHeader } = run(value);
    expect(id).toBe(value);
    expect(loggedHeader).toBe(value);
    expect(responseHeader).toBe(value);
  });

  it('trims surrounding whitespace from an otherwise safe id', () => {
    expect(resolveRequestId('  abc-123  ')).toBe('abc-123');
  });

  it.each([
    ['too long', 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1)],
    ['600 chars', 'x'.repeat(600)],
    ['html/script', '<script>alert(1)</script>'],
    ['control chars', 'abc\u0000def'],
    ['CRLF', 'abc\r\nSet-Cookie: x=1'],
    ['tab', 'abc\tdef'],
    ['spaces inside', 'abc def'],
    ['quotes', 'abc"def'],
    ['non-ascii', 'réquête'],
    ['empty', ''],
    ['blank', '   '],
  ])('replaces an unsafe client id (%s) with a server UUID and never reflects it', (_label, value) => {
    const { id, loggedHeader, responseHeader } = run(value);
    expect(id).toMatch(UUID);
    expect(responseHeader).toBe(id);
    // What the request serializer will log is the replacement, not the raw input.
    expect(loggedHeader).toBe(id);
    expect(JSON.stringify({ id, loggedHeader, responseHeader })).not.toContain(value.trim() || '\u0000');
  });

  it('rejects a repeated header (array value)', () => {
    const { id, loggedHeader } = run(['a', 'b']);
    expect(id).toMatch(UUID);
    expect(loggedHeader).toBe(id);
  });

  it('generates a UUID when no header is sent, without adding one to the request', () => {
    const { id, loggedHeader, responseHeader } = run(undefined);
    expect(id).toMatch(UUID);
    expect(responseHeader).toBe(id);
    expect(loggedHeader).toBeUndefined();
  });

  it('isSafeRequestId only accepts non-empty strings', () => {
    expect(isSafeRequestId(undefined)).toBe(false);
    expect(isSafeRequestId(42)).toBe(false);
    expect(isSafeRequestId('ok')).toBe(true);
  });
});
