import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { WhatsAppAccountService } from '../../whatsapp/whatsapp-account.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppSearchMessagesInput {
  @IsString()
  @MinLength(1)
  query: string;
}

@Injectable()
export class WhatsAppSearchMessagesTool implements MoraTool<WhatsAppSearchMessagesInput> {
  readonly name = 'whatsapp_search_messages';
  readonly description = 'Recherche texte dans les messages WhatsApp de Mora (scope/space courant).';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: WhatsAppAccountService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppSearchMessagesInput> {
    return validateWithDto(WhatsAppSearchMessagesInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppSearchMessagesInput): Promise<ToolResult> {
    const accounts = await this.accountService.list(context.userId);
    const messages = await this.prisma.whatsAppMessage.findMany({
      where: {
        conversation: { accountId: { in: accounts.map((a) => a.id) }, scope: context.scope, space: context.space },
        text: { contains: input.query, mode: 'insensitive' },
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    return { ok: true, data: messages };
  }
}
