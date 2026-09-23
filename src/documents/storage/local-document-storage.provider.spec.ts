import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDocumentStorageProvider } from './local-document-storage.provider.js';

function buildProvider(storageDir = './storage/documents-test') {
  const configService = { get: () => storageDir };
  return new LocalDocumentStorageProvider(configService as never);
}

describe('LocalDocumentStorageProvider — path traversal defense', () => {
  let provider: LocalDocumentStorageProvider;

  beforeEach(() => {
    provider = buildProvider();
  });

  it('never derives the storage key from the raw original filename (path-traversal-safe by construction)', async () => {
    const ref = await provider.save('user-1', Buffer.from('hello'), '../../../etc/passwd');
    expect(ref.storageKey).not.toContain('..');
    expect(ref.storageKey.startsWith('user-1/')).toBe(true);
    await provider.delete(ref.storageKey);
  });

  it('rejects a crafted storage key that attempts to escape the base directory', async () => {
    await expect(provider.read('../../../../etc/passwd')).rejects.toThrow(/path traversal/i);
  });

  it('round-trips a real file (write then read returns the same bytes)', async () => {
    const ref = await provider.save('user-2', Buffer.from('test content'), 'doc.txt');
    const read = await provider.read(ref.storageKey);
    expect(read.toString()).toBe('test content');
    await provider.delete(ref.storageKey);
  });

  it('sanitizes a hostile extension rather than embedding it verbatim', async () => {
    const ref = await provider.save('user-3', Buffer.from('x'), 'file.txt/../../evil.sh');
    expect(ref.storageKey).not.toContain('..');
    await provider.delete(ref.storageKey);
  });
});
