import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CONTACT_REMOTE_QUEUE, REMOTE_DELETE_JOB, REMOTE_UPDATE_JOB } from '../contacts/contact-remote.constants.js';
import type { RemoteContactSnapshot } from '../contacts/contact-remote-sync.service.js';
import { googleRequest } from './google-api.util.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const PEOPLE = 'https://people.googleapis.com/v1';
const UPDATE_FIELDS = 'names,organizations,phoneNumbers,emailAddresses';

/**
 * Applies edits and deletions made in Mora to the contact's Google copy.
 * A contact already removed on Google's side is not an error: there is
 * nothing left to update or delete.
 */
@Processor(CONTACT_REMOTE_QUEUE, { concurrency: 2 })
export class GoogleContactsRemoteProcessor extends WorkerHost {
  private readonly logger = new Logger(GoogleContactsRemoteProcessor.name);

  constructor(private readonly oauth: GoogleOAuthService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === REMOTE_UPDATE_JOB) {
      await this.update(job.data as RemoteContactSnapshot);
    } else if (job.name === REMOTE_DELETE_JOB) {
      await this.remove(job.data as { userId: string; googleResourceName: string });
    }
  }

  private async update(snapshot: RemoteContactSnapshot): Promise<void> {
    const token = await this.oauth.getAccessToken(snapshot.userId);
    let current: { etag?: string };
    try {
      current = await googleRequest<{ etag?: string }>(`${PEOPLE}/${snapshot.googleResourceName}?personFields=${UPDATE_FIELDS}`, token);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    await googleRequest(`${PEOPLE}/${snapshot.googleResourceName}:updateContact?updatePersonFields=${UPDATE_FIELDS}`, token, {
      method: 'PATCH',
      body: {
        etag: current.etag,
        names: [{ givenName: snapshot.name }],
        organizations: snapshot.company ? [{ name: snapshot.company }] : [],
        phoneNumbers: snapshot.phones.map((value) => ({ value })),
        emailAddresses: snapshot.emails.map((value) => ({ value })),
      },
    });
    this.logger.log('Google contact updated from Mora');
  }

  private async remove(data: { userId: string; googleResourceName: string }): Promise<void> {
    const token = await this.oauth.getAccessToken(data.userId);
    const res = await fetch(`${PEOPLE}/${data.googleResourceName}:deleteContact`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google delete failed with status ${res.status}`);
    }
    this.logger.log('Google contact deleted from Mora');
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /Google API 404/.test(error.message);
}
