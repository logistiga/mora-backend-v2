import type { PrismaService } from '../../database/prisma.service.js';
import type { ContactService } from '../../contacts/contact.service.js';
import type { ToolContext, ToolResult } from '../tool.types.js';

export interface WhatsAppTarget {
  contactId: string;
  name: string;
  numberLast4: string;
}

/**
 * Finds the one contact a WhatsApp message should go to, from a name typed by
 * the user. It never guesses: no match, no WhatsApp number, a blocked contact,
 * or several contacts with that name all return an error the assistant turns
 * into a question. Only the last 4 digits of a number ever leave this function.
 */
export async function resolveWhatsAppTarget(
  deps: { prisma: PrismaService; contactService: ContactService },
  context: ToolContext,
  name: string,
): Promise<{ target: WhatsAppTarget } | { error: ToolResult }> {
  const matches = await deps.contactService.list(context.userId, {
    scope: context.scope,
    space: context.space,
    search: name,
  });
  if (matches.length === 0) {
    return { error: { ok: false, errorCode: 'contact_not_found', errorMessage: `Aucun contact nommé « ${name} ». Demande son numéro à l'utilisateur.` } };
  }

  const withNumber: Array<{ contact: (typeof matches)[number]; number: string }> = [];
  for (const contact of matches) {
    const identity = await deps.prisma.contactIdentity.findFirst({ where: { contactId: contact.id, type: 'whatsapp' } });
    if (identity) withNumber.push({ contact, number: identity.valueNormalized });
  }
  if (withNumber.length === 0) {
    return { error: { ok: false, errorCode: 'contact_no_whatsapp', errorMessage: `« ${matches[0].name} » n'a pas de numéro WhatsApp enregistré.` } };
  }

  // An exact name match wins over partial matches ("Mustapha" vs "Mustapha Benali").
  const wanted = name.trim().toLowerCase();
  const exact = withNumber.filter((entry) => entry.contact.name.trim().toLowerCase() === wanted);
  const pool = exact.length > 0 ? exact : withNumber;

  if (pool.length > 1) {
    return {
      error: {
        ok: false,
        errorCode: 'ambiguous_contact',
        errorMessage:
          'Plusieurs contacts correspondent. Demande à l’utilisateur lequel il veut, en affichant le nom, l’entreprise et les 4 derniers chiffres du numéro.',
        data: {
          candidates: pool.map(({ contact, number }) => ({
            name: contact.name,
            company: contact.company ?? null,
            numberLast4: number.slice(-4),
          })),
        },
      },
    };
  }

  const [only] = pool;
  if (only.contact.trustLevel === 'blocked') {
    return { error: { ok: false, errorCode: 'contact_blocked', errorMessage: `« ${only.contact.name} » est bloqué : aucun message envoyé.` } };
  }

  return { target: { contactId: only.contact.id, name: only.contact.name, numberLast4: only.number.slice(-4) } };
}
