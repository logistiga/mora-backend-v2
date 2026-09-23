import { Injectable } from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailMessageService } from '../../email/email-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailSendInput {
  @IsUUID()
  threadId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text: string;
}

/** N2: always requires confirmation before sending (AGENTS §37). */
@Injectable()
export class EmailSendTool implements MoraTool<EmailSendInput> {
  readonly name = 'email_send';
  readonly description = 'Envoie un email (nécessite toujours une confirmation).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { threadId: { type: 'string', format: 'uuid' }, subject: { type: 'string' }, text: { type: 'string' } },
    required: ['threadId', 'subject', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: EmailMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailSendInput> {
    return validateWithDto(EmailSendInput, input);
  }

  async execute(context: ToolContext, input: EmailSendInput): Promise<ToolResult> {
    const thread = await this.prisma.emailThread.findUnique({ where: { id: input.threadId } });
    if (!thread || thread.scope !== context.scope || thread.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    if (thread.contactId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: thread.contactId } });
      if (contact?.trustLevel === 'blocked') return { ok: false, errorCode: 'contact_blocked' };
    }

    try {
      const message = await this.messageService.sendAndPersist(context.userId, input.threadId, input.subject, input.text);
      return { ok: true, data: message };
    } catch (error) {
      return { ok: false, errorCode: 'send_failed', errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed' };
    }
  }
}
