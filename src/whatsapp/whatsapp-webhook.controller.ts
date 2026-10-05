import { BadRequestException, Body, Controller, Headers, Logger, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { EvolutionWebhookDto } from './dto/evolution-webhook.dto.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';
import { maskJid } from './webhook-diagnostics.util.js';

const MAX_TEXT_LENGTH = 4000;

/**
 * Public endpoint (no JWT — the caller is Evolution API, not a Mora user).
 * Authenticity check (AGENTS §27): a shared secret header, since Evolution
 * API's own webhook signing scheme is not universally available across
 * self-hosted instances — documented as the actual verification mechanism
 * used here. `accountId` comes from the URL path (a real, unguessable DB
 * id) and is the ONLY source of `userId`/scope — nothing in the request
 * body can ever choose it (AGENTS §27: "Aucun webhook ne doit pouvoir
 * choisir userId/scope arbitrairement"). Global ThrottlerGuard (APP_GUARD)
 * already rate-limits this route like every other endpoint.
 */
@ApiTags('whatsapp-webhook')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: WhatsAppMessageService,
    private readonly configService: ConfigService,
  ) {}

  @Post(':accountId')
  async handle(
    @Param('accountId') accountId: string,
    @Headers('x-webhook-secret') providedSecret: string | undefined,
    @Body() payload: EvolutionWebhookDto,
  ) {
    const expectedSecret = this.configService.get<string>('app.whatsapp.webhookSecret');
    if (expectedSecret && providedSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const account = await this.prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Unknown WhatsApp account');

    const data = payload.data;
    if (!data || typeof data !== 'object') {
      this.logger.warn(JSON.stringify({ kind: 'webhook_result', result: 'ignored', reason: 'no_data' }));
      return { received: true, processed: false };
    }

    if (payload.event === 'messages.update') {
      const keyId = !Array.isArray(data) && typeof data.keyId === 'string' ? data.keyId : null;
      const processed = keyId ? await this.messageService.applyDeliveryStatus(account.id, keyId, (data as Record<string, unknown>).status) : false;
      this.logger.log(JSON.stringify({ kind: 'webhook_result', result: processed ? 'processed' : 'ignored', reason: processed ? undefined : 'status_not_applied' }));
      return { received: true, processed, kind: 'status' };
    }

    // Evolution may deliver one message as an object or a batch as an array.
    // An array used to fall through to "no key" and return 201 without storing anything.
    const items: unknown[] = Array.isArray(data) ? data : [data];
    let processed = false;
    for (const item of items) {
      const result = await this.handleInboundItem(account.id, account.userId, item);
      processed = processed || result;
    }
    return { received: true, processed };
  }

  private async handleInboundItem(accountId: string, userId: string, item: unknown): Promise<boolean> {
    if (!item || typeof item !== 'object') {
      this.logger.warn(JSON.stringify({ kind: 'webhook_result', result: 'ignored', reason: 'item_not_object' }));
      return false;
    }
    const message = extractMessage(item as Record<string, unknown>);
    if (!message) {
      const key = (item as Record<string, unknown>).key as { remoteJid?: unknown; fromMe?: unknown } | undefined;
      this.logger.warn(
        JSON.stringify({
          kind: 'webhook_result',
          result: 'ignored',
          reason: 'no_message_key',
          remoteJid: maskJid(key?.remoteJid),
          fromMe: typeof key?.fromMe === 'boolean' ? key.fromMe : null,
        }),
      );
      return false;
    }
    if (message.text && message.text.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException('Message text exceeds maximum accepted length');
    }

    const stored = await this.messageService.ingestInbound(userId, {
      accountId,
      providerMessageId: message.providerMessageId,
      fromNumber: message.fromNumber,
      text: message.text,
      timestamp: message.timestamp,
    });

    this.logger.log(
      JSON.stringify({
        kind: 'webhook_result',
        result: stored ? 'processed' : 'duplicate_or_blocked',
        fromNumber: maskJid(message.fromNumber),
        providerMessageId: message.providerMessageId,
      }),
    );
    return stored !== null;
  }
}

function extractMessage(
  data: Record<string, unknown>,
): { providerMessageId: string; fromNumber: string; text?: string; timestamp: Date } | null {
  const key = data.key as { id?: string; remoteJid?: string } | undefined;
  const messageBody = data.message as { conversation?: string } | undefined;
  if (!key?.id || !key.remoteJid) return null;

  return {
    providerMessageId: key.id,
    fromNumber: key.remoteJid.split('@')[0],
    text: messageBody?.conversation,
    timestamp: typeof data.messageTimestamp === 'number' ? new Date(data.messageTimestamp * 1000) : new Date(),
  };
}
