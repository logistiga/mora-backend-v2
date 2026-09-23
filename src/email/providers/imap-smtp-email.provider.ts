import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailProviderInterface,
  EmailSendResult,
  FetchedEmail,
  ResolvedEmailConnection,
} from './email-provider.interface.js';

const FETCH_LIMIT = 20;

/**
 * Real IMAP (fetch) / SMTP (send) implementation using `imapflow` and
 * `nodemailer`. IMPORTANT — test status (AGENTS Phase E §33/§58): no real
 * IMAP/SMTP test mailbox credentials were available in this session, so
 * this adapter has NOT been exercised against a real mail server. It is
 * CONTRACT-level: real library calls with the documented protocol
 * semantics, covered by unit tests with a mocked client, never a real
 * network connection.
 */
@Injectable()
export class ImapSmtpEmailProvider implements EmailProviderInterface {
  readonly provider = 'imap_smtp';
  private readonly logger = new Logger(ImapSmtpEmailProvider.name);

  async fetchRecent(connection: ResolvedEmailConnection): Promise<FetchedEmail[]> {
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');

    const client = new ImapFlow({
      host: connection.imapHost!,
      port: connection.imapPort ?? 993,
      secure: true,
      auth: { user: connection.username ?? connection.address, pass: connection.password ?? '' },
      logger: false,
    });

    const results: FetchedEmail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        const recentUids = (uids as number[]).slice(-FETCH_LIMIT);
        for await (const message of client.fetch(recentUids, { source: true, uid: true }, { uid: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source as Buffer);
          results.push({
            providerMessageId: parsed.messageId ?? `uid-${message.uid}`,
            from: parsed.from?.text ?? 'unknown',
            to: toAddressList(parsed.to),
            cc: toAddressList(parsed.cc),
            subject: parsed.subject,
            textBody: parsed.text,
            htmlBody: typeof parsed.html === 'string' ? parsed.html : undefined,
            receivedAt: parsed.date ?? new Date(),
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    return results;
  }

  async send(
    connection: ResolvedEmailConnection,
    message: { to: string[]; cc?: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] },
  ): Promise<EmailSendResult> {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: connection.smtpHost,
      port: connection.smtpPort ?? 587,
      secure: (connection.smtpPort ?? 587) === 465,
      auth: { user: connection.username ?? connection.address, pass: connection.password ?? '' },
    });

    const info = await transporter.sendMail({
      from: connection.address,
      to: message.to.join(', '),
      cc: message.cc?.join(', '),
      subject: message.subject,
      text: message.text,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });

    return { providerMessageId: info.messageId };
  }

  async checkHealth(connection: ResolvedEmailConnection): Promise<{ connected: boolean; error?: string }> {
    try {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({
        host: connection.imapHost!,
        port: connection.imapPort ?? 993,
        secure: true,
        auth: { user: connection.username ?? connection.address, pass: connection.password ?? '' },
        logger: false,
      });
      await client.connect();
      await client.logout();
      return { connected: true };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error' };
    }
  }
}

function toAddressList(field: { text: string }[] | { text: string } | undefined): string[] {
  if (!field) return [];
  return Array.isArray(field) ? field.map((f) => f.text) : [field.text];
}
