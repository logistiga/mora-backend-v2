import { Injectable } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ContactService } from '../../contacts/contact.service.js';
import { EmailMessageService } from '../../email/email-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailSendToContactInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text: string;
}

/**
 * Writes a new e-mail to a contact found by name in the address book. Like
 * WhatsApp, it never guesses between homonyms: it asks the user which one.
 * The user confirms the message before it is sent.
 */
@Injectable()
export class EmailSendToContactTool implements MoraTool<EmailSendToContactInput> {
  readonly name = 'email_send_to_contact';
  readonly description =
    "Écrit un nouveau e-mail à un contact du carnet par son nom (pas une réponse). L'utilisateur confirme avant l'envoi. Si plusieurs contacts portent ce nom, demande lequel.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { name: { type: 'string' }, subject: { type: 'string' }, text: { type: 'string' } },
    required: ['name', 'subject', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly emailMessages: EmailMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailSendToContactInput> {
    return validateWithDto(EmailSendToContactInput, input);
  }

  async execute(context: ToolContext, input: EmailSendToContactInput): Promise<ToolResult> {
    const matches = await this.contactService.list(context.userId, { search: input.name });
    const withEmail: Array<{ id: string; name: string; company: string | null; trustLevel: string; email: string }> = [];
    for (const contact of matches) {
      const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId: contact.id, type: 'email' } });
      if (identity) withEmail.push({ id: contact.id, name: contact.name, company: contact.company ?? null, trustLevel: contact.trustLevel, email: identity.valueNormalized });
    }
    if (withEmail.length === 0) {
      return {
        ok: false,
        errorCode: matches.length === 0 ? 'contact_not_found' : 'contact_no_email',
        errorMessage:
          matches.length === 0
            ? `Aucun contact nommé « ${input.name} ». Demande son adresse e-mail à l'utilisateur.`
            : `« ${matches[0].name} » n'a pas d'adresse e-mail enregistrée.`,
      };
    }

    const wanted = input.name.trim().toLowerCase();
    const exact = withEmail.filter((entry) => entry.name.trim().toLowerCase() === wanted);
    const pool = exact.length > 0 ? exact : withEmail;
    if (pool.length > 1) {
      return {
        ok: false,
        errorCode: 'ambiguous_contact',
        errorMessage: 'Plusieurs contacts correspondent. Demande à l’utilisateur lequel, avec le nom, l’entreprise et le domaine de l’e-mail.',
        data: { candidates: pool.map(({ name, company, email }) => ({ name, company, emailDomain: email.split('@')[1] ?? '' })) },
      };
    }

    const [target] = pool;
    if (target.trustLevel === 'blocked') return { ok: false, errorCode: 'contact_blocked', errorMessage: `« ${target.name} » est bloqué.` };

    try {
      await this.emailMessages.sendNewToContact(context.userId, target.id, input.subject, input.text);
      return { ok: true, data: { sentTo: target.name, emailDomain: target.email.split('@')[1] ?? '' } };
    } catch (error) {
      return { ok: false, errorCode: 'send_failed', errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed' };
    }
  }
}
