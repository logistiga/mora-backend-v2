import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailMessageService } from '../../email/email-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailReadThreadInput {
  @IsUUID()
  threadId: string;
}

@Injectable()
export class EmailReadThreadTool implements MoraTool<EmailReadThreadInput> {
  readonly name = 'email_read_thread';
  readonly description = "Lit les messages d'un fil email de Mora.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { threadId: { type: 'string', format: 'uuid' } },
    required: ['threadId'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: EmailMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailReadThreadInput> {
    return validateWithDto(EmailReadThreadInput, input);
  }

  async execute(context: ToolContext, input: EmailReadThreadInput): Promise<ToolResult> {
    const thread = await this.prisma.emailThread.findUnique({ where: { id: input.threadId } });
    if (!thread || thread.scope !== context.scope || thread.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const messages = await this.messageService.readThread(input.threadId);
    return { ok: true, data: messages };
  }
}
