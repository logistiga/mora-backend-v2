import { Injectable } from '@nestjs/common';
import { EmailAccountService } from '../../email/email-account.service.js';
import { EmailMessageService } from '../../email/email-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailListThreadsInput {}

@Injectable()
export class EmailListThreadsTool implements MoraTool<EmailListThreadsInput> {
  readonly name = 'email_list_threads';
  readonly description = "Liste les fils email de Mora (ses propres comptes, jamais la boîte personnelle de l'utilisateur).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(
    private readonly accountService: EmailAccountService,
    private readonly messageService: EmailMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailListThreadsInput> {
    return validateWithDto(EmailListThreadsInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    const accounts = await this.accountService.list(context.userId);
    const threads = await this.messageService.listThreads(accounts.map((a) => a.id));
    return { ok: true, data: threads.filter((t) => t.scope === context.scope && t.space === context.space) };
  }
}
