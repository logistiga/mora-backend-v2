export interface WhatsAppSendResult {
  providerMessageId: string;
}

export interface ResolvedWhatsAppConnection {
  accountId: string;
  provider: string;
  baseUrl?: string;
  instanceId?: string;
  apiKey?: string; // decrypted, in-memory only, for the duration of one call
}

/**
 * Provider abstraction (AGENTS Phase E §24) — the domain (WhatsAppService,
 * tools, webhook handling) never talks to Evolution API's wire format
 * directly. `MetaCloudWhatsAppProvider` would implement the same interface
 * later without touching any caller.
 */
export interface WhatsAppProviderInterface {
  readonly provider: string;

  sendTextMessage(connection: ResolvedWhatsAppConnection, to: string, text: string): Promise<WhatsAppSendResult>;
  sendDocument(
    connection: ResolvedWhatsAppConnection,
    to: string,
    document: { buffer: Buffer; filename: string; mimeType: string },
  ): Promise<WhatsAppSendResult>;
  checkHealth(connection: ResolvedWhatsAppConnection): Promise<{ connected: boolean; error?: string }>;
}
