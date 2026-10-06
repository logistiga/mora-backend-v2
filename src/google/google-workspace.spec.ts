import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleDocsService } from './google-docs.service.js';
import { googleRequest } from './google-api.util.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('googleRequest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('explains a disabled Google API in plain words, not as a crash', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"Google Calendar API has not been used in project 1 before or it is disabled."}}', { status: 403 }),
    );
    await expect(googleRequest('https://x', 'AT')).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"API has not been used in project 1 before or it is disabled."}}', { status: 403 }),
    );
    await expect(googleRequest('https://x', 'AT')).rejects.toThrow(/activez-la/);
  });

  it('does not leak the Google response body on other errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('secret details', { status: 500 }));
    await expect(googleRequest('https://x', 'AT')).rejects.toThrow('Google API 500');
  });
});

describe('GoogleContactsSyncService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let contacts: { findByIdentity: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; addIdentity: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let service: GoogleContactsSyncService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    contacts = {
      findByIdentity: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'c-new' })),
      addIdentity: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    };
    const oauth = { getAccessToken: vi.fn(async () => 'AT') };
    service = new GoogleContactsSyncService(oauth as never, contacts as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('imports a new contact with its international phone and email identities', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        connections: [
          {
            names: [{ displayName: 'Mustapha' }],
            phoneNumbers: [{ value: '+241 77 10 45 45' }],
            emailAddresses: [{ value: 'Mustapha@Example.com' }],
            organizations: [{ name: 'LogistiGA' }],
          },
        ],
      }),
    );
    const result = await service.sync('u1');
    expect(result).toEqual({ imported: 1, alreadyKnown: 0, renamed: 0, skippedNoName: 0 });
    expect(contacts.create).toHaveBeenCalledWith('u1', expect.objectContaining({ name: 'Mustapha', scope: 'personal', space: 'personal', company: 'LogistiGA' }));
    expect(contacts.addIdentity).toHaveBeenCalledWith('u1', 'c-new', { type: 'whatsapp', value: '+24177104545' });
    expect(contacts.addIdentity).toHaveBeenCalledWith('u1', 'c-new', { type: 'email', value: 'mustapha@example.com' });
  });

  it('never invents an international number from a local-format one', async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [{ names: [{ displayName: 'Local' }], phoneNumbers: [{ value: '077 10 45 45' }] }] }));
    await service.sync('u1');
    expect(contacts.addIdentity).not.toHaveBeenCalled();
    expect(contacts.create).toHaveBeenCalled();
  });

  it('leaves a contact that already has a real name untouched', async () => {
    contacts.findByIdentity.mockResolvedValueOnce({ id: 'existing', name: 'Déjà nommé' });
    fetchMock.mockResolvedValueOnce(json({ connections: [{ names: [{ displayName: 'Known' }], phoneNumbers: [{ value: '+24162222111' }] }] }));
    const result = await service.sync('u1');
    expect(result).toEqual({ imported: 0, alreadyKnown: 1, renamed: 0, skippedNoName: 0 });
    expect(contacts.update).not.toHaveBeenCalled();
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it('gives a known number its Google name when the contact only has the number as name', async () => {
    contacts.findByIdentity.mockResolvedValueOnce({ id: 'auto', name: '+24162222111' });
    fetchMock.mockResolvedValueOnce(json({ connections: [{ names: [{ displayName: 'Ami Google' }], phoneNumbers: [{ value: '+24162222111' }] }] }));
    const result = await service.sync('u1');
    expect(result).toEqual({ imported: 0, alreadyKnown: 0, renamed: 1, skippedNoName: 0 });
    expect(contacts.update).toHaveBeenCalledWith('u1', 'auto', { name: 'Ami Google' });
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it('skips a person without any name and follows pagination', async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [{ phoneNumbers: [{ value: '+24165000000' }] }], nextPageToken: 'P2' }));
    fetchMock.mockResolvedValueOnce(json({ connections: [{ names: [{ displayName: 'Second' }] }] }));
    const result = await service.sync('u1');
    expect(result).toEqual({ imported: 1, alreadyKnown: 0, renamed: 0, skippedNoName: 1 });
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=P2');
  });
});

describe('GoogleDocsService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists only Google Docs, newest first', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'd1', name: 'Rapport', modifiedTime: '2026-10-05T10:00:00Z' }] }));
    const service = new GoogleDocsService({ getAccessToken: vi.fn(async () => 'AT') } as never);
    const docs = await service.listDocuments('u1', 5);
    expect(docs).toEqual([{ id: 'd1', title: 'Rapport', modifiedTime: '2026-10-05T10:00:00Z', webViewLink: undefined }]);
    const url = decodeURIComponent(fetchMock.mock.calls[0][0]);
    expect(url).toContain("mimeType='application/vnd.google-apps.document'");
    expect(url).toContain('pageSize=5');
  });

  it('reads the text of a document, including table cells, and caps its length', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        documentId: 'doc123456789',
        title: 'Note',
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: 'Bonjour\n' } }] } },
            { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'cellule\n' } }] } }] }] }] } },
          ],
        },
      }),
    );
    const service = new GoogleDocsService({ getAccessToken: vi.fn(async () => 'AT') } as never);
    const doc = await service.readDocument('u1', 'doc123456789');
    expect(doc.text).toBe('Bonjour\ncellule\n');
    expect(doc.truncated).toBe(false);
  });

  it('rejects a malformed document id before calling Google', async () => {
    const service = new GoogleDocsService({ getAccessToken: vi.fn(async () => 'AT') } as never);
    await expect(service.readDocument('u1', '../etc')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
