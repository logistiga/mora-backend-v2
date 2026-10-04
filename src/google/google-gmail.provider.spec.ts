import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRawMessage, GoogleGmailEmailProvider, toFetchedEmail } from './google-gmail.provider.js';

const conn = { accountId: 'a1', userId: 'u1', provider: 'gmail', address: 'omar@example.com' } as never;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function build() {
  const oauth = { getAccessToken: vi.fn(async () => 'AT') };
  return { provider: new GoogleGmailEmailProvider(oauth as never), oauth };
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('Gmail MIME encoding', () => {
  it('builds a plain-text message with UTF-8 subject and recipients', () => {
    const raw = decodeRaw(buildRawMessage({ to: ['a@x.com'], subject: 'Réunion demain', text: 'Bonjour' }));
    expect(raw).toContain('To: a@x.com');
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
  });

  it('keeps an ASCII subject readable and adds a multipart body when attachments exist', () => {
    const raw = decodeRaw(
      buildRawMessage({
        to: ['a@x.com'],
        cc: ['b@x.com'],
        subject: 'Facture',
        text: 'Voir pièce jointe',
        attachments: [{ filename: 'f.pdf', content: Buffer.from('PDF'), contentType: 'application/pdf' }],
      }),
    );
    expect(raw).toContain('Subject: Facture');
    expect(raw).toContain('Cc: b@x.com');
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('Content-Disposition: attachment; filename="f.pdf"');
    expect(raw).toContain(Buffer.from('PDF').toString('base64'));
  });
});

describe('Gmail message parsing', () => {
  it('extracts headers and prefers the text part of a multipart message', () => {
    const email = toFetchedEmail({
      id: 'm1',
      internalDate: '1790000000000',
      payload: {
        headers: [
          { name: 'From', value: 'Mustapha <m@x.com>' },
          { name: 'To', value: 'a@x.com, b@x.com' },
          { name: 'Subject', value: 'Tarifs' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('Texte').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<p>Texte</p>').toString('base64url') } },
        ],
      },
    });
    expect(email.providerMessageId).toBe('m1');
    expect(email.from).toBe('Mustapha <m@x.com>');
    expect(email.to).toEqual(['a@x.com', 'b@x.com']);
    expect(email.subject).toBe('Tarifs');
    expect(email.textBody).toBe('Texte');
    expect(email.htmlBody).toBe('<p>Texte</p>');
  });
});

describe('GoogleGmailEmailProvider REST calls', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists inbox messages then fetches each one', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(json({ messages: [{ id: 'm1' }] }));
    fetchMock.mockResolvedValueOnce(json({ id: 'm1', payload: { headers: [{ name: 'Subject', value: 'Hi' }], body: {} } }));
    const emails = await provider.fetchRecent(conn);
    expect(fetchMock.mock.calls[0][0]).toContain('/users/me/messages?labelIds=INBOX');
    expect(emails.map((e) => e.providerMessageId)).toEqual(['m1']);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer AT');
  });

  it('sends through messages.send with a base64url raw body', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(json({ id: 'sent-1' }));
    const result = await provider.send(conn, { to: ['a@x.com'], subject: 'S', text: 'T' });
    expect(result.providerMessageId).toBe('sent-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/messages/send');
    expect(init.method).toBe('POST');
    expect(typeof JSON.parse(init.body).raw).toBe('string');
  });

  it('refuses to send with no recipient, before any network call', async () => {
    const { provider } = build();
    await expect(provider.send(conn, { to: [], subject: 'S', text: 'T' })).rejects.toThrow(/recipient/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a health failure instead of throwing', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const health = await provider.checkHealth(conn);
    expect(health.connected).toBe(false);
    expect(health.error).toMatch(/403/);
  });

  it('fails closed when the connection has no owner', async () => {
    const { provider } = build();
    await expect(provider.fetchRecent({ ...(conn as object), userId: undefined } as never)).rejects.toThrow(/no owner/);
  });
});
