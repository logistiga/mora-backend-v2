import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  EmailProviderInterface,
  EmailSendResult,
  FetchedEmail,
  ResolvedEmailConnection,
} from '../email/providers/email-provider.interface.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FETCH_LIMIT = 20;

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
}

/**
 * Gmail over the REST API with the user's Google grant. Same
 * EmailProviderInterface as IMAP/SMTP, so threads, ingestion and tools do not
 * change. Gmail assigns its own ids, so `sinceUid` is ignored here.
 */
@Injectable()
export class GoogleGmailEmailProvider implements EmailProviderInterface {
  readonly provider = 'gmail';

  constructor(private readonly oauth: GoogleOAuthService) {}

  async fetchRecent(connection: ResolvedEmailConnection): Promise<FetchedEmail[]> {
    const list = await this.request<{ messages?: Array<{ id: string }> }>(
      connection,
      `/messages?labelIds=INBOX&maxResults=${FETCH_LIMIT}`,
    );
    const emails: FetchedEmail[] = [];
    for (const ref of list.messages ?? []) {
      const message = await this.request<GmailMessage>(connection, `/messages/${ref.id}?format=full`);
      emails.push(toFetchedEmail(message));
    }
    return emails;
  }

  async send(
    connection: ResolvedEmailConnection,
    message: { to: string[]; cc?: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] },
  ): Promise<EmailSendResult> {
    if (message.to.length === 0) throw new BadRequestException('At least one recipient is required');
    const raw = buildRawMessage(message);
    const sent = await this.request<{ id: string }>(connection, '/messages/send', {
      method: 'POST',
      body: { raw },
    });
    return { providerMessageId: sent.id };
  }

  async checkHealth(connection: ResolvedEmailConnection): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.request(connection, '/profile');
      return { connected: true };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown_error' };
    }
  }

  private async request<T>(
    connection: ResolvedEmailConnection,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    if (!connection.userId) throw new Error('Gmail connection has no owner');
    const token = await this.oauth.getAccessToken(connection.userId);
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gmail API ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

export function toFetchedEmail(message: GmailMessage): FetchedEmail {
  const headers = new Map<string, string>();
  for (const h of message.payload?.headers ?? []) headers.set(h.name.toLowerCase(), h.value);
  const { text, html } = extractBodies(message.payload);
  return {
    providerMessageId: message.id,
    from: headers.get('from') ?? '',
    to: splitAddresses(headers.get('to')),
    cc: splitAddresses(headers.get('cc')),
    subject: headers.get('subject'),
    textBody: text,
    htmlBody: html,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
  };
}

function extractBodies(part: GmailPart | undefined): { text?: string; html?: string } {
  if (!part) return {};
  if (part.parts?.length) {
    const found = part.parts.map(extractBodies);
    return {
      text: found.map((f) => f.text).find(Boolean),
      html: found.map((f) => f.html).find(Boolean),
    };
  }
  const decoded = part.body?.data ? decodeBase64Url(part.body.data) : undefined;
  if (part.mimeType === 'text/plain') return { text: decoded };
  if (part.mimeType === 'text/html') return { html: decoded };
  return {};
}

function splitAddresses(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((a) => a.trim()).filter(Boolean);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrap76(base64: string): string {
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

/** RFC 2822 message, base64url-encoded for the Gmail send endpoint. */
export function buildRawMessage(message: {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}): string {
  const headers = [
    `To: ${message.to.join(', ')}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
  ];
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(message.text, 'utf8').toString('base64')),
  ].join('\r\n');

  let body: string;
  if (!message.attachments?.length) {
    body = [...headers, textPart].join('\r\n');
  } else {
    const boundary = `mora-${Date.now().toString(36)}`;
    const attachmentParts = message.attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${encodeHeader(a.filename)}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`,
        '',
        wrap76(a.content.toString('base64')),
      ].join('\r\n'),
    );
    body = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      textPart,
      ...attachmentParts,
      `--${boundary}--`,
    ].join('\r\n');
  }
  return Buffer.from(body, 'utf8').toString('base64url');
}
