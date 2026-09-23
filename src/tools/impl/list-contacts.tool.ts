import { Injectable } from '@nestjs/common';
import { ContactService } from '../../contacts/contact.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class ListContactsInput {}

@Injectable()
export class ListContactsTool implements MoraTool<ListContactsInput> {
  readonly name = 'list_contacts';
  readonly description = "Liste les contacts de l'utilisateur dans le scope/space courant.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<ListContactsInput> {
    return validateWithDto(ListContactsInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    const contacts = await this.contactService.list(context.userId, { scope: context.scope, space: context.space });
    return { ok: true, data: contacts };
  }
}
