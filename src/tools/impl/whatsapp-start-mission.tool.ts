import { Injectable } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ContactService } from '../../contacts/contact.service.js';
import { WhatsAppMissionService } from '../../whatsapp/whatsapp-mission.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';
import { resolveWhatsAppTarget } from './whatsapp-contact-resolver.js';

class WhatsAppStartMissionInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  contactName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  objective: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  questions: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  openingMessage: string;
}

/**
 * Starts a goal-driven WhatsApp conversation. requiresConfirmation is true:
 * the user approves the opening message and the questions before anything is
 * sent, and the executor only calls execute() after that approval.
 */
@Injectable()
export class WhatsAppStartMissionTool implements MoraTool<WhatsAppStartMissionInput> {
  readonly name = 'whatsapp_start_mission';
  readonly description =
    "Lance une mission WhatsApp : Mora écrit à un contact, mène la conversation vers un objectif (ex. prendre un rendez-vous), puis envoie un compte rendu. Le premier message n'est envoyé qu'après confirmation de l'utilisateur.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      contactName: { type: 'string' },
      objective: { type: 'string' },
      questions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
      openingMessage: { type: 'string' },
    },
    required: ['contactName', 'objective', 'questions', 'openingMessage'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly missions: WhatsAppMissionService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppStartMissionInput> {
    return validateWithDto(WhatsAppStartMissionInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppStartMissionInput): Promise<ToolResult> {
    const resolved = await resolveWhatsAppTarget({ prisma: this.prisma, contactService: this.contactService }, context, input.contactName);
    if ('error' in resolved) return resolved.error;

    try {
      const started = await this.missions.start({
        userId: context.userId,
        contactId: resolved.target.contactId,
        contactName: resolved.target.name,
        objective: input.objective,
        questions: input.questions,
        openingMessage: input.openingMessage,
        scope: context.scope,
        space: context.space,
      });
      return { ok: true, data: { missionId: started.missionId, sentTo: resolved.target.name, numberLast4: resolved.target.numberLast4 } };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'mission_failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'mission failed',
      };
    }
  }
}
