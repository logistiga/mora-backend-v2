import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ContactService } from '../contacts/contact.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { WhatsAppMessage } from '../generated/prisma/client.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import type { WhatsAppProviderInterface } from './providers/whatsapp-provider.interface.js';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.token.js';

export interface InboundWhatsAppMessage {
  accountId: string;
  providerMessageId: string;
  fromNumber: string;
  text?: string;
  timestamp: Date;
}

const DEFAULT_SCOPE = 'professional';
const DEFAULT_SPACE = 'general';

/**
 * Owns inbound persistence (dedup on `providerMessageId`, AGENTS §26/§27),
 * contact resolution/creation, conversation bookkeeping, and outbound
 * sending (always via the ToolExecutor/pending_action path for anything
 * user-visible — this service itself has no "send without confirmation"
 * method exposed to a controller, only to the approved-tool execution path
 * in WhatsAppSendMessageTool).
 */
@Injectable()
export class WhatsAppMessageService {
  private readonly logger = new Logger(WhatsAppMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly accountService: WhatsAppAccountService,
    private readonly auditService: AuditService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProviderInterface,
  ) {}

  /**
   * Idempotent by design: a duplicate webhook delivery for the same
   * `providerMessageId` is a no-op (AGENTS §26/§27 — "gérer message
   * duplicate"), never a second stored message or a second contact touch.
   */
  async ingestInbound(userId: string, input: InboundWhatsAppMessage): Promise<WhatsAppMessage | null> {
    const existing = await this.prisma.whatsAppMessage.findUnique({ where: { providerMessageId: input.providerMessageId } });
    if (existing) {
      this.logger.debug(`Duplicate inbound WhatsApp message ${input.providerMessageId}, skipping`);
      return null;
    }

    let contact = await this.contactService.findByIdentity(userId, 'whatsapp', input.fromNumber);
    if (!contact) {
      contact = await this.contactService.create(userId, {
        name: input.fromNumber,
        scope: DEFAULT_SCOPE,
        space: DEFAULT_SPACE,
        trustLevel: 'unknown',
      });
      await this.contactService.addIdentity(userId, contact.id, { type: 'whatsapp', value: input.fromNumber });
    }

    // A blocked contact is never engaged with at all — not even stored
    // beyond the audit trail (AGENTS §23/§29).
    if (contact.trustLevel === 'blocked') {
      await this.auditService.log({
        userId,
        action: 'whatsapp_message_blocked_contact',
        scope: DEFAULT_SCOPE,
        space: DEFAULT_SPACE,
        metadata: { fromNumber: redactPhone(input.fromNumber) },
      });
      return null;
    }

    const conversation = await this.getOrCreateConversation(input.accountId, contact.id);

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        providerMessageId: input.providerMessageId,
        direction: 'inbound',
        contactId: contact.id,
        timestamp: input.timestamp,
        text: input.text,
      },
    });

    await this.prisma.whatsAppConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: input.timestamp } });
    await this.contactService.touchLastInteraction(contact.id);

    await this.auditService.log({
      userId,
      action: 'whatsapp_message_received',
      scope: DEFAULT_SCOPE,
      space: DEFAULT_SPACE,
      metadata: { conversationId: conversation.id, trustLevel: contact.trustLevel },
    });

    return message;
  }

  /**
   * Actually sends via the provider and persists the outbound message.
   * Never called directly from a controller — only from
   * WhatsAppSendMessageTool.execute(), itself only ever reached after
   * ToolExecutor's N2/N3 confirmation policy already approved it
   * (AGENTS §30).
   */
  async sendAndPersist(userId: string, conversationId: string, text: string): Promise<WhatsAppMessage> {
    const conversation = await this.prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } });
    const connection = await this.accountService.resolveConnection(conversation.accountId);

    const result = await this.provider.sendTextMessage(connection, await this.contactNumber(conversation.contactId), text);

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        providerMessageId: result.providerMessageId,
        direction: 'outbound',
        contactId: conversation.contactId,
        timestamp: new Date(),
        text,
      },
    });

    await this.auditService.log({
      userId,
      action: 'whatsapp_message_sent',
      scope: conversation.scope,
      space: conversation.space,
      metadata: { conversationId },
    });

    return message;
  }

  async listConversations(accountIds: string[]) {
    return this.prisma.whatsAppConversation.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }

  async readMessages(conversationId: string, limit = 50) {
    return this.prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  private async getOrCreateConversation(accountId: string, contactId: string) {
    const existing = await this.prisma.whatsAppConversation.findFirst({ where: { accountId, contactId } });
    if (existing) return existing;
    return this.prisma.whatsAppConversation.create({
      data: { accountId, contactId, scope: DEFAULT_SCOPE, space: DEFAULT_SPACE },
    });
  }

  private async contactNumber(contactId: string | null): Promise<string> {
    if (!contactId) throw new Error('Conversation has no associated contact');
    const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId, type: 'whatsapp' } });
    if (!identity) throw new Error('Contact has no WhatsApp identity');
    return identity.valueNormalized;
  }
}

/** Phone numbers are PII — audit metadata keeps only the last 4 digits. */
function redactPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : '***';
}
