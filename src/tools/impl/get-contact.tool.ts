import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { ContactService } from '../../contacts/contact.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class GetContactInput {
  @IsUUID()
  contactId: string;
}

@Injectable()
export class GetContactTool implements MoraTool<GetContactInput> {
  readonly name = 'get_contact';
  readonly description = 'Récupère un contact (identités, niveau de confiance, notes).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { contactId: { type: 'string', format: 'uuid' } },
    required: ['contactId'],
    additionalProperties: false as const,
  };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<GetContactInput> {
    return validateWithDto(GetContactInput, input);
  }

  async execute(context: ToolContext, input: GetContactInput): Promise<ToolResult> {
    const contact = await this.contactService.getById(context.userId, input.contactId);
    if (contact.scope !== context.scope || contact.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    return { ok: true, data: contact };
  }
}
