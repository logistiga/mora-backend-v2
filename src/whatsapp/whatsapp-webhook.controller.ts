import { BadRequestException, Body, Controller, Headers, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { EvolutionWebhookDto } from './dto/evolution-webhook.dto.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';

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
      return { received: true, processed: false };
    }

    const message = extractMessage(data);
    if (!message) {
      return { received: true, processed: false };
    }
    if (message.text && message.text.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException('Message text exceeds maximum accepted length');
    }

    await this.messageService.ingestInbound(account.userId, {
      accountId: account.id,
      providerMessageId: message.providerMessageId,
      fromNumber: message.fromNumber,
      text: message.text,
      timestamp: message.timestamp,
    });

    return { received: true, processed: true };
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
