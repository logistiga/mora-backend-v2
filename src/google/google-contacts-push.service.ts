import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { googleRequest } from './google-api.util.js';
import { GoogleOAuthService, GoogleReauthRequiredError, GOOGLE_SCOPES } from './google-oauth.service.js';

const CREATE_URL = 'https://people.googleapis.com/v1/people:createContact';
const MAX_PER_RUN = 200;

export interface ContactPushResult {
  pushed: number;
  failed: number;
}

/** The part of a Mora contact that Google's People API takes. */
export interface PushableContact {
  name: string;
  company: string | null;
  identities: Array<{ type: string; valueNormalized: string }>;
}

/** A name that is empty or only digits/symbols: not worth creating in Google. */
function isPlaceholderName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '' || /^[+\d\s()\-.]+$/.test(trimmed);
}

/** Builds the People API body for a contact. Phone numbers go out in international form only. */
export function buildGoogleContactBody(contact: PushableContact): Record<string, unknown> {
  const phones = contact.identities.filter((i) => i.type === 'whatsapp').map((i) => ({ value: i.valueNormalized }));
  const emails = contact.identities.filter((i) => i.type === 'email').map((i) => ({ value: i.valueNormalized }));
  return {
    names: [{ givenName: contact.name.trim() }],
    ...(contact.company ? { organizations: [{ name: contact.company }] } : {}),
    ...(phones.length > 0 ? { phoneNumbers: phones } : {}),
    ...(emails.length > 0 ? { emailAddresses: emails } : {}),
  };
}

/**
 * Pushes contacts created in Mora into the user's Google address
 * book. A contact is pushed once: its Google resource name is stored right
 * after creation, so the next run and the next pull never duplicate it.
 */
@Injectable()
export class GoogleContactsPushService {
  private readonly logger = new Logger(GoogleContactsPushService.name);

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async push(userId: string): Promise<ContactPushResult> {
    const status = await this.oauth.getStatus(userId);
    if (!status.scopes.includes(GOOGLE_SCOPES.contactsWrite)) {
      throw new GoogleReauthRequiredError('Reconnectez Google pour autoriser Mora à écrire dans vos contacts.');
    }
    const token = await this.oauth.getAccessToken(userId);

    const pending = await this.prisma.contact.findMany({
      where: { userId, googleResourceName: null },
      include: { identities: true },
      take: MAX_PER_RUN,
      orderBy: { createdAt: 'asc' },
    });

    const result: ContactPushResult = { pushed: 0, failed: 0 };
    for (const contact of pending) {
      if (isPlaceholderName(contact.name)) continue;
      try {
        const created = await googleRequest<{ resourceName?: string }>(CREATE_URL, token, {
          method: 'POST',
          body: buildGoogleContactBody(contact),
        });
        if (created.resourceName) {
          await this.prisma.contact.update({ where: { id: contact.id }, data: { googleResourceName: created.resourceName } });
        }
        result.pushed += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.warn(`Push to Google failed for one contact: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return result;
  }
}
