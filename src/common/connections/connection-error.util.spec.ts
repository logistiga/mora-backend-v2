import { describe, expect, it } from 'vitest';
import { CONNECTION_ERROR_CODES, classifyConnectionError } from './connection-error.util.js';

describe('classifyConnectionError', () => {
  it('maps real provider failures to a closed set of codes', () => {
    expect(classifyConnectionError(new Error('Invalid credentials (AUTHENTICATIONFAILED)'))).toBe('auth_failed');
    expect(classifyConnectionError(new Error('getaddrinfo ENOTFOUND imap.example.com'))).toBe('host_unreachable');
    expect(classifyConnectionError(new Error('connect ETIMEDOUT 10.0.0.4:993'))).toBe('timeout');
    expect(classifyConnectionError(new Error('self signed certificate in certificate chain'))).toBe('tls_error');
    expect(classifyConnectionError(new Error('Evolution API returned status 500'))).toBe('rejected_by_provider');
    expect(classifyConnectionError(new Error('something entirely new'))).toBe('unknown_error');
    expect(classifyConnectionError(undefined)).toBe('unknown_error');
  });

  it('never returns any fragment of the underlying message', () => {
    const secretish = new Error('LOGIN failed for omar@logistiga.com on imap.logistiga.tech:993 (password rejected)');
    const code = classifyConnectionError(secretish);

    expect(CONNECTION_ERROR_CODES).toContain(code);
    expect(code).not.toMatch(/omar|logistiga|993|password/);
  });
});
