import { createHash } from 'node:crypto';

/** SHA-256 hex digest — used for dedup (AGENTS Phase E §2). */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
