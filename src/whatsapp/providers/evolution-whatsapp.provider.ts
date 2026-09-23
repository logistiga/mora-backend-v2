import { Injectable, Logger } from '@nestjs/common';
import type {
  ResolvedWhatsAppConnection,
  WhatsAppProviderInterface,
  WhatsAppSendResult,
} from './whatsapp-provider.interface.js';

/**
 * Real implementation against Evolution API's documented REST contract
 * (https://doc.evolution-api.com — `/message/sendText/:instance`,
 * `/message/sendMedia/:instance`, `/instance/connectionState/:instance`).
 *
 * IMPORTANT — test status (AGENTS Phase E §32, honestly reported in the
 * final report): this adapter has NOT been exercised against a real
 * Evolution API instance in this session. The only Evolution instance this
 * environment could reach is on the production VPS, which the brief
 * explicitly forbids touching without separate authorization. This class is
 * CONTRACT-level: it correctly implements the documented wire format and is
 * covered by tests using a mocked `fetch`, never a real network call.
 */
@Injectable()
export class EvolutionWhatsAppProvider implements WhatsAppProviderInterface {
  readonly provider = 'evolution';
  private readonly logger = new Logger(EvolutionWhatsAppProvider.name);

  async sendTextMessage(connection: ResolvedWhatsAppConnection, to: string, text: string): Promise<WhatsAppSendResult> {
    const response = await fetch(`${connection.baseUrl}/message/sendText/${connection.instanceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: connection.apiKey ?? '' },
      body: JSON.stringify({ number: to, text }),
    });
    if (!response.ok) {
      throw new Error(`Evolution API sendText failed with status ${response.status}`);
    }
    const data = (await response.json()) as { key?: { id?: string } };
    return { providerMessageId: data.key?.id ?? `unknown-${Date.now()}` };
  }

  async sendDocument(
    connection: ResolvedWhatsAppConnection,
    to: string,
    document: { buffer: Buffer; filename: string; mimeType: string },
  ): Promise<WhatsAppSendResult> {
    const response = await fetch(`${connection.baseUrl}/message/sendMedia/${connection.instanceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: connection.apiKey ?? '' },
      body: JSON.stringify({
        number: to,
        mediatype: 'document',
        media: document.buffer.toString('base64'),
        fileName: document.filename,
        mimetype: document.mimeType,
      }),
    });
    if (!response.ok) {
      throw new Error(`Evolution API sendMedia failed with status ${response.status}`);
    }
    const data = (await response.json()) as { key?: { id?: string } };
    return { providerMessageId: data.key?.id ?? `unknown-${Date.now()}` };
  }

  async checkHealth(connection: ResolvedWhatsAppConnection): Promise<{ connected: boolean; error?: string }> {
    try {
      const response = await fetch(`${connection.baseUrl}/instance/connectionState/${connection.instanceId}`, {
        headers: { apikey: connection.apiKey ?? '' },
      });
      if (!response.ok) {
        return { connected: false, error: `status ${response.status}` };
      }
      const data = (await response.json()) as { instance?: { state?: string } };
      return { connected: data.instance?.state === 'open' };
    } catch (error) {
      // Never leak a raw stack/internal detail into stored health state.
      return { connected: false, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error' };
    }
  }
}
