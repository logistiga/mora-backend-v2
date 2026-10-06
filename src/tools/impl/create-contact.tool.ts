import { Injectable } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
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

  /** International format, e.g. +24107778899. Stored as the WhatsApp identity. */
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be in international format, e.g. +24107778899' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

@Injectable()
export class CreateContactTool implements MoraTool<CreateContactInput> {
  readonly name = 'create_contact';
  readonly description =
    'Crée un nouveau contact dans le scope/space de la conversation en cours. Peut aussi enregistrer son numéro WhatsApp (format international, ex. +24107778899) et son e-mail.';
  readonly version = '1.1.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      name: { type: 'string' },
      company: { type: 'string' },
      trustLevel: { type: 'string', enum: TRUST_LEVELS },
      phone: { type: 'string' },
      email: { type: 'string' },
    },
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
    if (input.phone) {
      await this.contactService.addIdentity(context.userId, contact.id, { type: 'whatsapp', value: input.phone });
    }
    if (input.email) {
      await this.contactService.addIdentity(context.userId, contact.id, { type: 'email', value: input.email });
    }
    return { ok: true, data: { id: contact.id, name: contact.name, company: contact.company ?? null } };
  }
}
