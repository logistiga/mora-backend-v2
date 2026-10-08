import { Injectable } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ContactService } from '../../contacts/contact.service.js';
import { WhatsAppMessageService } from '../../whatsapp/whatsapp-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';
import { resolveWhatsAppTarget } from './whatsapp-contact-resolver.js';

class WhatsAppSendToContactInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}

/**
 * Sends a WhatsApp message to a contact found by name. Ambiguity is never
 * resolved by guessing: see resolveWhatsAppTarget.
 */
@Injectable()
export class WhatsAppSendToContactTool implements MoraTool<WhatsAppSendToContactInput> {
  readonly name = 'whatsapp_send_to_contact';
  readonly description =
    "Envoie un message WhatsApp à un contact par son nom. Si plusieurs contacts portent ce nom, rien n'est envoyé : demande à l'utilisateur lequel (nom + entreprise ou 4 derniers chiffres du numéro).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { name: { type: 'string' }, text: { type: 'string' } },
    required: ['name', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly messageService: WhatsAppMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppSendToContactInput> {
    return validateWithDto(WhatsAppSendToContactInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppSendToContactInput): Promise<ToolResult> {
    const resolved = await resolveWhatsAppTarget({ prisma: this.prisma, contactService: this.contactService }, context, input.name);
    if ('error' in resolved) return resolved.error;

    try {
      const message = await this.messageService.sendToContact(context.userId, resolved.target.contactId, input.text);
      return { ok: true, data: { sentTo: resolved.target.name, numberLast4: resolved.target.numberLast4, messageId: message.id } };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'send_failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed',
      };
    }
  }
}
