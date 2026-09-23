import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DocumentStorageInterface, StoredFileRef } from './document-storage.interface.js';

/**
 * Local filesystem implementation (dev/Phase E default). Architecture ready
 * for S3/MinIO later — any future provider only needs to implement
 * `DocumentStorageInterface`, nothing else in the document pipeline changes
 * (AGENTS Phase E §2).
 *
 * Security: the storage key is ALWAYS `<userId>/<uuid>.<safeExt>` — never
 * derived from the user-supplied original filename, which is the actual
 * path-traversal defense (a filename like `../../etc/passwd` never reaches
 * the filesystem path at all). `read()`/`delete()` additionally resolve the
 * final path and refuse anything that escapes the configured base directory.
 */
@Injectable()
export class LocalDocumentStorageProvider implements DocumentStorageInterface {
  readonly provider = 'local';
  private readonly logger = new Logger(LocalDocumentStorageProvider.name);
  private readonly baseDir: string;

  constructor(configService: ConfigService) {
    this.baseDir = path.resolve(configService.get<string>('app.documents.storageDir') ?? './storage/documents');
  }

  async save(userId: string, buffer: Buffer, originalFilename: string): Promise<StoredFileRef> {
    const safeExt = sanitizeExtension(path.extname(originalFilename));
    const storageKey = `${userId}/${randomUUID()}${safeExt}`;
    const fullPath = this.resolveSafe(storageKey);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    this.logger.debug(`Stored document for user ${userId} at key ${storageKey}`);
    return { storageProvider: this.provider, storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveSafe(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveSafe(storageKey), { force: true });
  }

  /** Resolves a storage key to an absolute path, refusing anything that escapes `baseDir`. */
  private resolveSafe(storageKey: string): string {
    const fullPath = path.resolve(this.baseDir, storageKey);
    if (!fullPath.startsWith(this.baseDir + path.sep) && fullPath !== this.baseDir) {
      throw new Error('Invalid storage key: path traversal attempt detected');
    }
    return fullPath;
  }
}

/** Keeps only a short, known-safe extension — never the raw (possibly hostile) user string. */
function sanitizeExtension(ext: string): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return cleaned.length > 0 && cleaned.length <= 10 ? cleaned : '';
}
