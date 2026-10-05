import { Injectable } from '@nestjs/common';
import { ContactService } from '../contacts/contact.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { googleRequest } from './google-api.util.js';

const PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections';
const PERSON_FIELDS = 'names,phoneNumbers,emailAddresses,organizations';
const MAX_PAGES = 20;
const E164 = /^\+\d{8,15}$/;

interface GooglePerson {
  names?: Array<{ displayName?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

export interface ContactSyncResult {
  imported: number;
  alreadyKnown: number;
  skippedNoName: number;
}

/**
 * Imports the user's Google contacts into Mora's contact book, keyed by phone
 * and email identities. A phone number is only stored when it is already in
 * international form; a local-format number is never guessed into one.
 * Contacts already known by any of their identities are left untouched.
 */
@Injectable()
export class GoogleContactsSyncService {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly contacts: ContactService,
  ) {}

  async sync(userId: string): Promise<ContactSyncResult> {
    const token = await this.oauth.getAccessToken(userId);
    const result: ContactSyncResult = { imported: 0, alreadyKnown: 0, skippedNoName: 0 };

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

    for (const phone of phones) {
      if (await this.contacts.findByIdentity(userId, 'whatsapp', phone)) {
        result.alreadyKnown += 1;
        return;
      }
    }
    for (const email of emails) {
      if (await this.contacts.findByIdentity(userId, 'email', email)) {
        result.alreadyKnown += 1;
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
    for (const phone of phones) {
      await this.contacts.addIdentity(userId, contact.id, { type: 'whatsapp', value: phone });
    }
    for (const email of emails) {
      await this.contacts.addIdentity(userId, contact.id, { type: 'email', value: email });
    }
    result.imported += 1;
  }
}
