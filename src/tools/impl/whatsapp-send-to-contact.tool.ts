import { Injectable } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ContactService } from '../../contacts/contact.service.js';
import { WhatsAppMessageService } from '../../whatsapp/whatsapp-message.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class WhatsAppSendToContactInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}

interface WhatsAppCandidate {
  contactId: string;
  name: string;
  company: string | null;
  trustLevel: string;
  numberLast4: string;
  number: string;
}

/**
 * Sends a WhatsApp message to a contact found by name. It never guesses: no
 * match, no WhatsApp number, or several contacts with that name all return a
 * clear error the assistant turns into a question for the user.
 */
@Injectable()
export class WhatsAppSendToContactTool implements MoraTool<WhatsAppSendToContactInput> {
  readonly name = 'whatsapp_send_to_contact';
  readonly description =
    "Envoie un message WhatsApp à un contact par son nom. Si plusieurs contacts portent ce nom, rien n'est envoyé : demande à l'utilisateur lequel (nom + entreprise ou 4 derniers chiffres du numéro).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { name: { type: 'string' }, text: { type: 'string' } },
    required: ['name', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
    private readonly messageService: WhatsAppMessageService,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppSendToContactInput> {
    return validateWithDto(WhatsAppSendToContactInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppSendToContactInput): Promise<ToolResult> {
    const matches = await this.contactService.list(context.userId, {
      scope: context.scope,
      space: context.space,
      search: input.name,
    });
    if (matches.length === 0) {
      return { ok: false, errorCode: 'contact_not_found', errorMessage: `Aucun contact nommé « ${input.name} ». Demande son numéro à l'utilisateur.` };
    }

    const withNumber: WhatsAppCandidate[] = [];
    for (const contact of matches) {
      const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId: contact.id, type: 'whatsapp' } });
      if (identity) {
        withNumber.push({
          contactId: contact.id,
          name: contact.name,
          company: contact.company ?? null,
          trustLevel: contact.trustLevel,
          numberLast4: identity.valueNormalized.slice(-4),
          number: identity.valueNormalized,
        });
      }
    }
    if (withNumber.length === 0) {
      return { ok: false, errorCode: 'contact_no_whatsapp', errorMessage: `« ${matches[0].name} » n'a pas de numéro WhatsApp enregistré.` };
    }

    // An exact name match wins over partial matches ("Mustapha" vs "Mustapha Benali").
    const wanted = input.name.trim().toLowerCase();
    const exact = withNumber.filter((candidate) => candidate.name.trim().toLowerCase() === wanted);
    const pool = exact.length > 0 ? exact : withNumber;

    if (pool.length > 1) {
      return {
        ok: false,
        errorCode: 'ambiguous_contact',
        errorMessage:
          'Plusieurs contacts correspondent. Demande à l’utilisateur lequel il veut, en affichant le nom, l’entreprise et les 4 derniers chiffres du numéro.',
        data: {
          candidates: pool.map(({ name, company, numberLast4 }) => ({ name, company, numberLast4 })),
        },
      };
    }

    const target = pool[0];
    if (target.trustLevel === 'blocked') {
      return { ok: false, errorCode: 'contact_blocked', errorMessage: `« ${target.name} » est bloqué : aucun message envoyé.` };
    }

    try {
      const message = await this.messageService.sendToContact(context.userId, target.contactId, input.text);
      return { ok: true, data: { sentTo: target.name, numberLast4: target.numberLast4, messageId: message.id } };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'send_failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed',
      };
    }
  }
}
