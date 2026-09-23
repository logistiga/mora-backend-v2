import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { ContactService } from '../../contacts/contact.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppGetContactInput {
  @IsString()
  @MinLength(1)
  phoneNumber: string;
}

@Injectable()
export class WhatsAppGetContactTool implements MoraTool<WhatsAppGetContactInput> {
  readonly name = 'whatsapp_get_contact';
  readonly description = 'Résout un numéro WhatsApp vers le contact Mora correspondant (trust level, historique).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { phoneNumber: { type: 'string' } },
    required: ['phoneNumber'],
    additionalProperties: false as const,
  };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<WhatsAppGetContactInput> {
    return validateWithDto(WhatsAppGetContactInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppGetContactInput): Promise<ToolResult> {
    const contact = await this.contactService.findByIdentity(context.userId, 'whatsapp', input.phoneNumber);
    if (!contact) return { ok: true, data: null };
    if (contact.scope !== context.scope || contact.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    return { ok: true, data: contact };
  }
}
