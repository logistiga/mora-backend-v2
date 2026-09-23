import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { WhatsAppMessageService } from '../../whatsapp/whatsapp-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppReadMessagesInput {
  @IsUUID()
  conversationId: string;
}

@Injectable()
export class WhatsAppReadMessagesTool implements MoraTool<WhatsAppReadMessagesInput> {
  readonly name = 'whatsapp_read_messages';
  readonly description = "Lit les messages d'une conversation WhatsApp de Mora.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { conversationId: { type: 'string', format: 'uuid' } },
    required: ['conversationId'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: WhatsAppMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppReadMessagesInput> {
    return validateWithDto(WhatsAppReadMessagesInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppReadMessagesInput): Promise<ToolResult> {
    const conversation = await this.prisma.whatsAppConversation.findUnique({ where: { id: input.conversationId } });
    if (!conversation || conversation.scope !== context.scope || conversation.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const messages = await this.messageService.readMessages(input.conversationId);
    return { ok: true, data: messages };
  }
}
