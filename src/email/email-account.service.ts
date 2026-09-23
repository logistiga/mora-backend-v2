import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ENCRYPTION_VERSION, SecretEncryptionService } from '../ai-providers/secret-encryption.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { EmailAccount } from '../generated/prisma/client.js';
import type { CreateEmailAccountDto } from './dto/create-email-account.dto.js';
import type { ResolvedEmailConnection } from './providers/email-provider.interface.js';

interface StoredEmailSecret {
  username?: string;
  password?: string;
}

export interface EmailAccountPublicView {
  id: string;
  label: string;
  address: string;
  provider: string;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
}

/** Same AES-256-GCM reuse pattern as WhatsAppAccountService (AGENTS Phase E §34). */
@Injectable()
export class EmailAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretEncryption: SecretEncryptionService,
  ) {}

  async create(userId: string, dto: CreateEmailAccountDto): Promise<EmailAccountPublicView> {
    const hasSecret = dto.username || dto.password;
    const secret: StoredEmailSecret = { username: dto.username, password: dto.password };
    const encrypted = hasSecret ? this.secretEncryption.encryptSecret(JSON.stringify(secret)) : null;

    const account = await this.prisma.emailAccount.create({
      data: {
        userId,
        label: dto.label,
        address: dto.address,
        provider: dto.provider,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        credentialsEncrypted: encrypted?.ciphertext,
        credentialsIv: encrypted?.iv,
        credentialsAuthTag: encrypted?.authTag,
        status: 'configured',
      },
    });
    return toPublicView(account);
  }

  async list(userId: string): Promise<EmailAccountPublicView[]> {
    const accounts = await this.prisma.emailAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return accounts.map(toPublicView);
  }

  async getOwnedRow(userId: string, id: string): Promise<EmailAccount> {
    const account = await this.prisma.emailAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Email account not found');
    if (account.userId !== userId) throw new ForbiddenException('This account does not belong to you');
    return account;
  }

  async resolveConnection(accountId: string): Promise<ResolvedEmailConnection> {
    const account = await this.prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
    let secret: StoredEmailSecret = {};
    if (account.credentialsEncrypted && account.credentialsIv && account.credentialsAuthTag) {
      const plaintext = this.secretEncryption.decryptSecret({
        ciphertext: account.credentialsEncrypted,
        iv: account.credentialsIv,
        authTag: account.credentialsAuthTag,
        version: ENCRYPTION_VERSION,
      });
      secret = JSON.parse(plaintext) as StoredEmailSecret;
    }
    return {
      accountId: account.id,
      provider: account.provider,
      address: account.address,
      imapHost: account.imapHost ?? undefined,
      imapPort: account.imapPort ?? undefined,
      smtpHost: account.smtpHost ?? undefined,
      smtpPort: account.smtpPort ?? undefined,
      username: secret.username ?? account.address,
      password: secret.password,
    };
  }

  async updateHealth(accountId: string, status: string, lastError?: string): Promise<void> {
    await this.prisma.emailAccount.update({
      where: { id: accountId },
      data: { status, lastSyncAt: new Date(), lastError: lastError?.slice(0, 300) ?? null },
    });
  }
}

function toPublicView(account: EmailAccount): EmailAccountPublicView {
  return {
    id: account.id,
    label: account.label,
    address: account.address,
    provider: account.provider,
    status: account.status,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
  };
}
