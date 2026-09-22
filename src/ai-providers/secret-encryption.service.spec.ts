import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SecretEncryptionService } from './secret-encryption.service.js';

function buildService(key?: string) {
  const configServiceMock = { get: () => key };
  return new SecretEncryptionService(configServiceMock as never);
}

const VALID_KEY = randomBytes(32).toString('base64');

describe('SecretEncryptionService', () => {
  let service: SecretEncryptionService;

  beforeEach(() => {
    service = buildService(VALID_KEY);
  });

  it('round-trips a secret through encrypt/decrypt', () => {
    const plaintext = 'sk-super-secret-api-key-1234567890';
    const encrypted = service.encryptSecret(plaintext);
    const decrypted = service.decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('uses a different IV/nonce every time, even for the same plaintext', () => {
    const a = service.encryptSecret('same-secret');
    const b = service.encryptSecret('same-secret');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext); // GCM ciphertext differs when IV differs
  });

  it('throws when the auth tag has been tampered with', () => {
    const encrypted = service.encryptSecret('a secret');
    const tampered = { ...encrypted, authTag: service.encryptSecret('other').authTag };
    expect(() => service.decryptSecret(tampered)).toThrow();
  });

  it('throws when the ciphertext has been tampered with', () => {
    const encrypted = service.encryptSecret('a secret');
    const tamperedBytes = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
    const tampered = { ...encrypted, ciphertext: tamperedBytes.toString('base64') };
    expect(() => service.decryptSecret(tampered)).toThrow();
  });

  it('throws when decrypting with the wrong master key', () => {
    const encrypted = service.encryptSecret('a secret');
    const otherService = buildService(randomBytes(32).toString('base64'));
    expect(() => otherService.decryptSecret(encrypted)).toThrow();
  });

  it('throws a clear error when no master key is configured', () => {
    const unconfigured = buildService(undefined);
    expect(() => unconfigured.encryptSecret('x')).toThrow(/MORA_ENCRYPTION_KEY is not configured/);
  });

  it('throws when the master key is not valid base64 of the right length', () => {
    const badService = buildService('too-short');
    expect(() => badService.encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('validateEncryptionKey() throws for a missing key and passes for a valid one', () => {
    expect(() => buildService(undefined).validateEncryptionKey()).toThrow();
    expect(() => buildService(VALID_KEY).validateEncryptionKey()).not.toThrow();
  });

  describe('maskSecret', () => {
    it('returns only the last 4 characters', () => {
      expect(service.maskSecret('sk-1234567890abcdef')).toBe('cdef');
    });

    it('masks entirely a secret of 4 characters or fewer', () => {
      expect(service.maskSecret('abc')).toBe('***');
    });

    it('never returns the full secret', () => {
      const secret = 'sk-super-secret-api-key';
      const masked = service.maskSecret(secret);
      expect(masked).not.toBe(secret);
      expect(masked.length).toBeLessThanOrEqual(4);
    });
  });
});
