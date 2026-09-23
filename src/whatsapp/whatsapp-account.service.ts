import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ENCRYPTION_VERSION, SecretEncryptionService } from '../ai-providers/secret-encryption.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { WhatsAppAccount } from '../generated/prisma/client.js';
import type { CreateWhatsAppAccountDto } from './dto/create-whatsapp-account.dto.js';
import type { ResolvedWhatsAppConnection } from './providers/whatsapp-provider.interface.js';

interface StoredConnectionSecret {
  baseUrl?: string;
  instanceId?: string;
  apiKey?: string;
}

export interface WhatsAppAccountPublicView {
  id: string;
  label: string;
  phoneNumber: string;
  provider: string;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reuses Phase C.5's AES-256-GCM SecretEncryptionService (AGENTS Phase E
 * §25/§33) rather than a parallel crypto implementation. Connection details
 * (baseUrl/instanceId/apiKey) are bundled as one encrypted JSON blob —
 * never returned by any endpoint (`toPublicView` whitelists fields the same
 * way AiProviderService does for AI provider keys).
 */
@Injectable()
export class WhatsAppAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretEncryption: SecretEncryptionService,
  ) {}

  async create(userId: string, dto: CreateWhatsAppAccountDto): Promise<WhatsAppAccountPublicView> {
    const secret: StoredConnectionSecret = { ...dto.config, apiKey: dto.apiKey };
    const hasSecret = dto.apiKey || dto.config;
    const encrypted = hasSecret ? this.secretEncryption.encryptSecret(JSON.stringify(secret)) : null;

    const account = await this.prisma.whatsAppAccount.create({
      data: {
        userId,
        label: dto.label,
        phoneNumber: dto.phoneNumber,
        provider: dto.provider,
        credentialsEncrypted: encrypted?.ciphertext,
        credentialsIv: encrypted?.iv,
        credentialsAuthTag: encrypted?.authTag,
        status: 'configured',
      },
    });
    return toPublicView(account);
  }

  async list(userId: string): Promise<WhatsAppAccountPublicView[]> {
    const accounts = await this.prisma.whatsAppAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return accounts.map(toPublicView);
  }

  async getOwnedRow(userId: string, id: string): Promise<WhatsAppAccount> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    if (account.userId !== userId) throw new ForbiddenException('This account does not belong to you');
    return account;
  }

  /** Decrypted, in-memory only, for the duration of one provider call — never logged, never persisted elsewhere. */
  async resolveConnection(accountId: string): Promise<ResolvedWhatsAppConnection> {
    const account = await this.prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    let secret: StoredConnectionSecret = {};
    if (account.credentialsEncrypted && account.credentialsIv && account.credentialsAuthTag) {
      const plaintext = this.secretEncryption.decryptSecret({
        ciphertext: account.credentialsEncrypted,
        iv: account.credentialsIv,
        authTag: account.credentialsAuthTag,
        version: ENCRYPTION_VERSION,
      });
      secret = JSON.parse(plaintext) as StoredConnectionSecret;
    }
    return {
      accountId: account.id,
      provider: account.provider,
      baseUrl: secret.baseUrl,
      instanceId: secret.instanceId,
      apiKey: secret.apiKey,
    };
  }

  async updateHealth(accountId: string, status: string, lastError?: string): Promise<void> {
    await this.prisma.whatsAppAccount.update({
      where: { id: accountId },
      data: { status, lastSyncAt: new Date(), lastError: lastError?.slice(0, 300) ?? null },
    });
  }
}

function toPublicView(account: WhatsAppAccount): WhatsAppAccountPublicView {
  return {
    id: account.id,
    label: account.label,
    phoneNumber: account.phoneNumber,
    provider: account.provider,
    status: account.status,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
