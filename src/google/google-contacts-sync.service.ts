import { Injectable } from '@nestjs/common';
import { ContactService } from '../contacts/contact.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { googleRequest } from './google-api.util.js';

const PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections';
const PERSON_FIELDS = 'names,phoneNumbers,emailAddresses,organizations';
const MAX_PAGES = 20;
const E164 = /^\+\d{8,15}$/;

interface GooglePerson {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

export interface ContactSyncResult {
  imported: number;
  alreadyKnown: number;
  renamed: number;
  skippedNoName: number;
}

/** A name that is empty or only digits/symbols, like the number WhatsApp used before a real name was known. */
function isPlaceholderName(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  return trimmed === '' || /^[+\d\s()\-.]+$/.test(trimmed);
}

/**
 * Imports the user's Google contacts into Mora's contact book, keyed by phone
 * and email identities. A phone number is only stored when it is already in
 * international form; a local-format number is never guessed into one.
 * Contacts already known by any of their identities are left untouched, but
 * they get their Google resource name recorded so they are never pushed back.
 */
@Injectable()
export class GoogleContactsSyncService {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly contacts: ContactService,
    private readonly prisma: PrismaService,
  ) {}

  async sync(userId: string): Promise<ContactSyncResult> {
    const token = await this.oauth.getAccessToken(userId);
    const result: ContactSyncResult = { imported: 0, alreadyKnown: 0, renamed: 0, skippedNoName: 0 };

    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: '500' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await googleRequest<{ connections?: GooglePerson[]; nextPageToken?: string }>(
        `${PEOPLE_URL}?${query.toString()}`,
        token,
      );

      for (const person of response.connections ?? []) {
        await this.importPerson(userId, person, result);
      }

      if (!response.nextPageToken) break;
      pageToken = response.nextPageToken;
    }
    return result;
  }

  private async importPerson(userId: string, person: GooglePerson, result: ContactSyncResult): Promise<void> {
    const name = person.names?.find((n) => n.displayName)?.displayName?.trim();
    if (!name) {
      result.skippedNoName += 1;
      return;
    }

    const phones = (person.phoneNumbers ?? [])
      .map((p) => (p.value ?? '').replace(/[\s()\-.]/g, ''))
      .filter((v) => E164.test(v));
    const emails = (person.emailAddresses ?? [])
      .map((e) => (e.value ?? '').trim().toLowerCase())
      .filter((v) => v.includes('@'));

    for (const [type, values] of [
      ['whatsapp', phones],
      ['email', emails],
    ] as const) {
      for (const value of values) {
        const existing = await this.contacts.findByIdentity(userId, type, value);
        if (!existing) continue;
        if (person.resourceName) {
          await this.prisma.contact.updateMany({
            where: { id: existing.id, userId, googleResourceName: null },
            data: { googleResourceName: person.resourceName },
          });
        }
        // Known contact: only fill in a missing or number-only name, never overwrite a name the user set.
        if (isPlaceholderName(existing.name)) {
          await this.contacts.update(userId, existing.id, { name });
          result.renamed += 1;
        } else {
          result.alreadyKnown += 1;
        }
        return;
      }
    }

    const organization = person.organizations?.find((o) => o.name)?.name;
    const contact = await this.contacts.create(userId, {
      name,
      scope: 'personal',
      space: 'personal',
      company: organization,
    });
    if (person.resourceName) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { googleResourceName: person.resourceName } });
    }
    for (const phone of phones) {
      await this.contacts.addIdentity(userId, contact.id, { type: 'whatsapp', value: phone });
    }
    for (const email of emails) {
      await this.contacts.addIdentity(userId, contact.id, { type: 'email', value: email });
    }
    result.imported += 1;
  }
}
