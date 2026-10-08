import { Injectable } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ContactService } from '../../contacts/contact.service.js';
import { WhatsAppMissionService } from '../../whatsapp/whatsapp-mission.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';
import { resolveWhatsAppTarget } from './whatsapp-contact-resolver.js';

class WhatsAppCancelMissionInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  contactName: string;
}

/**
 * Stops an in-progress whatsapp_start_mission on demand ("arrête de contacter
 * X", "laisse tomber pour le rdv avec X") instead of only ever ending via the
 * message/time limits built into WhatsAppMissionService. No confirmation
 * required: stopping an action is always safe to do immediately, unlike
 * starting one.
 */
@Injectable()
export class WhatsAppCancelMissionTool implements MoraTool<WhatsAppCancelMissionInput> {
  readonly name = 'whatsapp_cancel_mission';
  readonly description =
    "Arrête une mission WhatsApp en cours avec un contact (Mora cesse de lui écrire). N'a aucun effet s'il n'y en a pas.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { contactName: { type: 'string' } },
    required: ['contactName'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly missions: WhatsAppMissionService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppCancelMissionInput> {
    return validateWithDto(WhatsAppCancelMissionInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppCancelMissionInput): Promise<ToolResult> {
    const resolved = await resolveWhatsAppTarget({ prisma: this.prisma, contactService: this.contactService }, context, input.contactName);
    if ('error' in resolved) return resolved.error;

    const cancelled = await this.missions.cancel(context.userId, resolved.target.contactId);
    return { ok: true, data: { cancelled, contact: resolved.target.name } };
  }
}
