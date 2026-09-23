import { Injectable } from '@nestjs/common';
import { WhatsAppAccountService } from '../../whatsapp/whatsapp-account.service.js';
import { WhatsAppMessageService } from '../../whatsapp/whatsapp-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppListConversationsInput {}

@Injectable()
export class WhatsAppListConversationsTool implements MoraTool<WhatsAppListConversationsInput> {
  readonly name = 'whatsapp_list_conversations';
  readonly description = "Liste les conversations WhatsApp de Mora (son propre numéro, jamais le WhatsApp personnel de l'utilisateur).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(
    private readonly accountService: WhatsAppAccountService,
    private readonly messageService: WhatsAppMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppListConversationsInput> {
    return validateWithDto(WhatsAppListConversationsInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    const accounts = await this.accountService.list(context.userId);
    const conversations = await this.messageService.listConversations(accounts.map((a) => a.id));
    return { ok: true, data: conversations.filter((c) => c.scope === context.scope && c.space === context.space) };
  }
}
