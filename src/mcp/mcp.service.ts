import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WhatsAppMessageService } from '../whatsapp/whatsapp-message.service.js';

const uuid = { type: 'string', description: 'UUID' };

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(userId: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * MCP tools exposed to Claude over HTTP. Each tool reuses the same services
 * as the REST API, so ownership checks and the confirm gate on sends apply
 * here too. Nothing bypasses them.
 */
@Injectable()
export class McpService {
  private readonly tools: McpTool[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: WhatsAppMessageService,
  ) {
    this.tools = [
      {
        name: 'whatsapp_list_conversations',
        description: 'Liste les conversations WhatsApp de Mora (les plus récentes en premier).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (userId) => {
          const accounts = await this.prisma.whatsAppAccount.findMany({ where: { userId }, select: { id: true } });
          return this.messages.listConversations(accounts.map((a) => a.id));
        },
      },
      {
        name: 'whatsapp_get_messages',
        description: "Lit les derniers messages d'une conversation WhatsApp.",
        inputSchema: {
          type: 'object',
          properties: { conversationId: uuid, limit: { type: 'integer', minimum: 1, maximum: 200 } },
          required: ['conversationId'],
          additionalProperties: false,
        },
        run: async (userId, args) => {
          const conversationId = String(args.conversationId ?? '');
          await this.messages.assertOwnedConversation(userId, conversationId);
          const limit = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 200) : 50;
          return this.messages.readMessages(conversationId, limit);
        },
      },
      {
        name: 'whatsapp_send_message',
        description:
          "Envoie un message WhatsApp. N'appelle cet outil qu'après que l'utilisateur a confirmé le destinataire et le texte ; `confirm` doit valoir true.",
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: uuid,
            text: { type: 'string', minLength: 1, maxLength: 4000 },
            confirm: { type: 'boolean', description: "Doit être true : l'utilisateur a validé l'envoi" },
          },
          required: ['conversationId', 'text', 'confirm'],
          additionalProperties: false,
        },
        run: async (userId, args) => {
          if (args.confirm !== true) {
            throw new BadRequestException('Envoi refusé : confirmation utilisateur absente (confirm=true requis).');
          }
          return this.messages.sendTextForUser(userId, String(args.conversationId ?? ''), String(args.text ?? ''));
        },
      },
      {
        name: 'whatsapp_get_message_status',
        description: "Donne le statut d'un message envoyé (sent, delivered, read, failed).",
        inputSchema: {
          type: 'object',
          properties: { messageId: uuid },
          required: ['messageId'],
          additionalProperties: false,
        },
        run: async (userId, args) => this.messages.getMessageForUser(userId, String(args.messageId ?? '')),
      },
    ];
  }

  listTools() {
    return this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  findTool(name: string): McpTool | undefined {
    return this.tools.find((t) => t.name === name);
  }
}
