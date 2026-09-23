export interface StoredFileRef {
  storageProvider: string;
  storageKey: string;
}

export interface DocumentStorageInterface {
  readonly provider: string;

  /** Persists a buffer, returns a storage key. Never trusts the caller's filename for the on-disk path. */
  save(userId: string, buffer: Buffer, originalFilename: string): Promise<StoredFileRef>;

  read(storageKey: string): Promise<Buffer>;

  delete(storageKey: string): Promise<void>;
}
