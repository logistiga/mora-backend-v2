import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce size
export const ENCRYPTION_VERSION = 1;

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  version: number;
}

/**
 * The only place in the codebase that touches MORA_ENCRYPTION_KEY or raw
 * provider API keys in memory. AiProviderService calls this to turn a
 * plaintext key into three opaque columns (and back) — it never implements
 * crypto itself (per AGENTS §4: "Ne mélange pas cette logique dans
 * AiProviderService").
 *
 * AES-256-GCM is authenticated encryption: a tampered ciphertext or a wrong
 * master key both fail loudly (decrypt throws) rather than silently
 * returning garbage — this is why it was chosen over a plain cipher mode.
 */
@Injectable()
export class SecretEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  private getKey(): Buffer {
    const raw = this.configService.get<string>('app.encryptionKey');
    if (!raw) {
      throw new Error(
        'MORA_ENCRYPTION_KEY is not configured — cannot encrypt or decrypt provider secrets.',
      );
    }
    let key: Buffer;
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      throw new Error('MORA_ENCRYPTION_KEY is not valid base64.');
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `MORA_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
          'Generate one with: openssl rand -base64 32',
      );
    }
    return key;
  }

  /** Throws with a clear message if MORA_ENCRYPTION_KEY is missing/malformed; returns void otherwise. */
  validateEncryptionKey(): void {
    this.getKey();
  }

  encryptSecret(plaintext: string): EncryptedSecret {
    const key = this.getKey();
    const iv = randomBytes(IV_BYTES); // unique per secret, per call — never reused
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      version: ENCRYPTION_VERSION,
    };
  }

  /** Throws if the master key is wrong OR the ciphertext/authTag was tampered with. */
  decryptSecret(encrypted: EncryptedSecret): string {
    const key = this.getKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(), // throws "Unsupported state or unable to authenticate data" on tamper/wrong key
    ]);
    return plaintext.toString('utf8');
  }

  /** Never logged/returned in full — only the last 4 characters, for the operator to recognize which key is which. */
  maskSecret(plaintext: string): string {
    if (plaintext.length <= 4) return '*'.repeat(plaintext.length);
    return plaintext.slice(-4);
  }
}
