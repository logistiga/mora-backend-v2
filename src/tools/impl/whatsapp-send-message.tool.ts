import { Injectable } from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { WhatsAppMessageService } from '../../whatsapp/whatsapp-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppSendMessageInput {
  @IsUUID()
  conversationId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}

/** N2: always requires confirmation — Phase E's default is "ENVOI = confirmation obligatoire" (AGENTS §30). */
@Injectable()
export class WhatsAppSendMessageTool implements MoraTool<WhatsAppSendMessageInput> {
  readonly name = 'whatsapp_send_message';
  readonly description = 'Envoie un message WhatsApp (nécessite toujours une confirmation).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { conversationId: { type: 'string', format: 'uuid' }, text: { type: 'string' } },
    required: ['conversationId', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: WhatsAppMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppSendMessageInput> {
    return validateWithDto(WhatsAppSendMessageInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppSendMessageInput): Promise<ToolResult> {
    const conversation = await this.prisma.whatsAppConversation.findUnique({ where: { id: input.conversationId } });
    if (!conversation || conversation.scope !== context.scope || conversation.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    if (conversation.contactId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: conversation.contactId } });
      if (contact?.trustLevel === 'blocked') {
        return { ok: false, errorCode: 'contact_blocked' };
      }
    }

    try {
      const message = await this.messageService.sendAndPersist(context.userId, input.conversationId, input.text);
      return { ok: true, data: message };
    } catch (error) {
      return { ok: false, errorCode: 'send_failed', errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed' };
    }
  }
}
