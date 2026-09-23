import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ContactService } from '../../contacts/contact.service.js';
import { TRUST_LEVELS, type TrustLevel } from '../../contacts/contact.types.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class UpdateContactInput {
  @IsUUID()
  contactId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: TrustLevel;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Injectable()
export class UpdateContactTool implements MoraTool<UpdateContactInput> {
  readonly name = 'update_contact';
  readonly description = "Modifie un contact existant (ex: niveau de confiance, notes).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      contactId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      trustLevel: { type: 'string', enum: TRUST_LEVELS },
      notes: { type: 'string' },
    },
    required: ['contactId'],
    additionalProperties: false as const,
  };

  constructor(private readonly contactService: ContactService) {}

  validate(input: unknown): ToolValidationResult<UpdateContactInput> {
    return validateWithDto(UpdateContactInput, input);
  }

  async execute(context: ToolContext, input: UpdateContactInput): Promise<ToolResult> {
    const existing = await this.contactService.getById(context.userId, input.contactId);
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const updated = await this.contactService.update(context.userId, input.contactId, {
      name: input.name,
      trustLevel: input.trustLevel,
      notes: input.notes,
    });
    return { ok: true, data: updated };
  }
}
