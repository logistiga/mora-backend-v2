import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ContactService } from '../../contacts/contact.service.js';
import { TRUST_LEVELS, type TrustLevel } from '../../contacts/contact.types.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CreateContactInput {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: TrustLevel;
}

@Injectable()
export class CreateContactTool implements MoraTool<CreateContactInput> {
  readonly name = 'create_contact';
  readonly description = 'Crée un nouveau contact dans le scope/space de la conversation en cours.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { name: { type: 'string' }, company: { type: 'string' }, trustLevel: { type: 'string', enum: TRUST_LEVELS } },
    required: ['name'],
    additionalProperties: false as const,
  };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<CreateContactInput> {
    return validateWithDto(CreateContactInput, input);
  }

  async execute(context: ToolContext, input: CreateContactInput): Promise<ToolResult> {
    const contact = await this.contactService.create(context.userId, {
      name: input.name,
      company: input.company,
      scope: context.scope,
      space: context.space,
      trustLevel: input.trustLevel,
    });
    return { ok: true, data: contact };
  }
}
