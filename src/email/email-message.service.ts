import { Inject, Injectable, Logger } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { AuditService } from '../audit/audit.service.js';
import { ContactService } from '../contacts/contact.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { EmailMessage } from '../generated/prisma/client.js';
import { EmailAccountService } from './email-account.service.js';
import type { EmailProviderInterface, FetchedEmail } from './providers/email-provider.interface.js';
import { EMAIL_PROVIDER } from './providers/email-provider.token.js';

const DEFAULT_SCOPE = 'professional';
const DEFAULT_SPACE = 'general';

/**
 * Sanitizes inbound HTML at ingest (AGENTS Phase E §38) — `htmlBodySanitized`
 * is the ONLY html ever stored/rendered; the raw provider HTML never
 * reaches the database. Strips scripts/event handlers/remote-resource tags
 * that could exfiltrate data or auto-load tracking pixels.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li', 'a', 'blockquote', 'span', 'div'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
};

@Injectable()
export class EmailMessageService {
  private readonly logger = new Logger(EmailMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly accountService: EmailAccountService,
    private readonly auditService: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProviderInterface,
  ) {}

  async syncInbound(userId: string, accountId: string): Promise<number> {
    const connection = await this.accountService.resolveConnection(accountId);
    const emails = await this.provider.fetchRecent(connection);
    let ingested = 0;
    for (const email of emails) {
      const created = await this.ingestOne(userId, accountId, email);
      if (created) ingested += 1;
    }
    await this.accountService.updateHealth(accountId, 'connected');
    return ingested;
  }

  /** Idempotent on `providerMessageId` (AGENTS §35). */
  private async ingestOne(userId: string, accountId: string, email: FetchedEmail): Promise<EmailMessage | null> {
    const existing = await this.prisma.emailMessage.findUnique({ where: { providerMessageId: email.providerMessageId } });
    if (existing) return null;

    const fromAddress = extractAddress(email.from);
    let contact = await this.contactService.findByIdentity(userId, 'email', fromAddress);
    if (!contact) {
      contact = await this.contactService.create(userId, {
        name: email.from,
        scope: DEFAULT_SCOPE,
        space: DEFAULT_SPACE,
        trustLevel: 'unknown',
      });
      await this.contactService.addIdentity(userId, contact.id, { type: 'email', value: fromAddress });
    }

    if (contact.trustLevel === 'blocked') {
      await this.auditService.log({ userId, action: 'email_message_blocked_contact', scope: DEFAULT_SCOPE, space: DEFAULT_SPACE, metadata: {} });
      return null;
    }

    const thread = await this.getOrCreateThread(accountId, contact.id, email.subject);

    const message = await this.prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        providerMessageId: email.providerMessageId,
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        textBody: email.textBody?.slice(0, 20000),
        htmlBodySanitized: email.htmlBody ? sanitizeHtml(email.htmlBody, SANITIZE_OPTIONS).slice(0, 40000) : undefined,
        direction: 'inbound',
        receivedAt: email.receivedAt,
        contactId: contact.id,
      },
    });

    await this.prisma.emailThread.update({ where: { id: thread.id }, data: { lastMessageAt: email.receivedAt } });
    await this.contactService.touchLastInteraction(contact.id);
    await this.auditService.log({ userId, action: 'email_message_received', scope: DEFAULT_SCOPE, space: DEFAULT_SPACE, metadata: { threadId: thread.id } });

    return message;
  }

  /** Only ever reached after ToolExecutor's N2/N3 confirmation approved the send (AGENTS §37). */
  async sendAndPersist(userId: string, threadId: string, subject: string, text: string): Promise<EmailMessage> {
    const thread = await this.prisma.emailThread.findUniqueOrThrow({ where: { id: threadId } });
    const connection = await this.accountService.resolveConnection(thread.accountId);

    const recipients = thread.contactId ? await this.contactAddresses(thread.contactId) : [];
    const result = await this.provider.send(connection, { to: recipients, subject, text });

    const message = await this.prisma.emailMessage.create({
      data: {
        threadId,
        providerMessageId: result.providerMessageId,
        from: connection.address,
        to: recipients,
        subject,
        textBody: text,
        direction: 'outbound',
        sentAt: new Date(),
        contactId: thread.contactId,
      },
    });

    await this.auditService.log({ userId, action: 'email_message_sent', scope: thread.scope, space: thread.space, metadata: { threadId } });
    return message;
  }

  async listThreads(accountIds: string[]) {
    return this.prisma.emailThread.findMany({ where: { accountId: { in: accountIds } }, orderBy: { lastMessageAt: 'desc' }, take: 100 });
  }

  async readThread(threadId: string) {
    return this.prisma.emailMessage.findMany({ where: { threadId }, orderBy: { receivedAt: 'asc' } });
  }

  private async getOrCreateThread(accountId: string, contactId: string, subject?: string) {
    const existing = await this.prisma.emailThread.findFirst({ where: { accountId, contactId } });
    if (existing) return existing;
    return this.prisma.emailThread.create({ data: { accountId, contactId, subject, scope: DEFAULT_SCOPE, space: DEFAULT_SPACE } });
  }

  private async contactAddresses(contactId: string): Promise<string[]> {
    const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId, type: 'email' } });
    return identity ? [identity.valueNormalized] : [];
  }
}

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}
