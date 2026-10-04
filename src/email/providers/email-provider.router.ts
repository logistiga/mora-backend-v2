import { Injectable } from '@nestjs/common';
import { GoogleGmailEmailProvider } from '../../google/google-gmail.provider.js';
import type {
  EmailProviderInterface,
  EmailSendResult,
  FetchedEmail,
  ResolvedEmailConnection,
} from './email-provider.interface.js';
import { ImapSmtpEmailProvider } from './imap-smtp-email.provider.js';

/** Routes each mailbox to its own protocol: a Gmail account uses the Google grant, everything else IMAP/SMTP. */
@Injectable()
export class EmailProviderRouter implements EmailProviderInterface {
  readonly provider = 'router';

  constructor(
    private readonly imap: ImapSmtpEmailProvider,
    private readonly gmail: GoogleGmailEmailProvider,
  ) {}

  private pick(connection: ResolvedEmailConnection): EmailProviderInterface {
    return connection.provider === 'gmail' ? this.gmail : this.imap;
  }

  fetchRecent(connection: ResolvedEmailConnection, sinceUid?: number): Promise<FetchedEmail[]> {
    return this.pick(connection).fetchRecent(connection, sinceUid);
  }

  send(
    connection: ResolvedEmailConnection,
    message: Parameters<EmailProviderInterface['send']>[1],
  ): Promise<EmailSendResult> {
    return this.pick(connection).send(connection, message);
  }

  checkHealth(connection: ResolvedEmailConnection): Promise<{ connected: boolean; error?: string }> {
    return this.pick(connection).checkHealth(connection);
  }
}
