import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { ContactService } from '../../contacts/contact.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class SearchContactsInput {
  @IsString()
  @MinLength(1)
  query: string;
}

@Injectable()
export class SearchContactsTool implements MoraTool<SearchContactsInput> {
  readonly name = 'search_contacts';
  readonly description = 'Recherche des contacts par nom/entreprise dans le scope/space courant.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false as const,
  };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<SearchContactsInput> {
    return validateWithDto(SearchContactsInput, input);
  }

  async execute(context: ToolContext, input: SearchContactsInput): Promise<ToolResult> {
    const contacts = await this.contactService.list(context.userId, {
      scope: context.scope,
      space: context.space,
      search: input.query,
    });
    return { ok: true, data: contacts };
  }
}
