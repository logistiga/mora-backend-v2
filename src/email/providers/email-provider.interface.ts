export interface ResolvedEmailConnection {
  accountId: string;
  provider: string;
  address: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  username?: string;
  password?: string; // decrypted, in-memory only
}

export interface FetchedEmail {
  providerMessageId: string;
  from: string;
  to: string[];
  cc: string[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt: Date;
}

export interface EmailSendResult {
  providerMessageId: string;
}

/**
 * Provider abstraction (AGENTS Phase E §33) — `GmailEmailProvider`/
 * `MicrosoftGraphEmailProvider` would implement the same interface later
 * (OAuth-based, not built here — no real credentials available).
 * `ImapSmtpEmailProvider` is Phase E's real, functional implementation.
 */
export interface EmailProviderInterface {
  readonly provider: string;

  fetchRecent(connection: ResolvedEmailConnection, sinceUid?: number): Promise<FetchedEmail[]>;
  send(
    connection: ResolvedEmailConnection,
    message: { to: string[]; cc?: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] },
  ): Promise<EmailSendResult>;
  checkHealth(connection: ResolvedEmailConnection): Promise<{ connected: boolean; error?: string }>;
}
