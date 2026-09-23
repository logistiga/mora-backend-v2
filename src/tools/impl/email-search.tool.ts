import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailAccountService } from '../../email/email-account.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailSearchInput {
  @IsString()
  @MinLength(1)
  query: string;
}

@Injectable()
export class EmailSearchTool implements MoraTool<EmailSearchInput> {
  readonly name = 'email_search';
  readonly description = 'Recherche texte (sujet/corps) dans les emails de Mora (scope/space courant).';
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
    private readonly accountService: EmailAccountService,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailSearchInput> {
    return validateWithDto(EmailSearchInput, input);
  }

  async execute(context: ToolContext, input: EmailSearchInput): Promise<ToolResult> {
    const accounts = await this.accountService.list(context.userId);
    const messages = await this.prisma.emailMessage.findMany({
      where: {
        thread: { accountId: { in: accounts.map((a) => a.id) }, scope: context.scope, space: context.space },
        OR: [
          { subject: { contains: input.query, mode: 'insensitive' } },
          { textBody: { contains: input.query, mode: 'insensitive' } },
        ],
      },
      orderBy: { receivedAt: 'desc' },
      take: 30,
    });
    return { ok: true, data: messages };
  }
}
