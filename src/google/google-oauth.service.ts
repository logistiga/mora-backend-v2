import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { SecretEncryptionService, type EncryptedSecret } from '../ai-providers/secret-encryption.service.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_SAFETY_MS = 60 * 1000;

export const GOOGLE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar',
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  email: 'openid email',
  // Read and write: Mora pushes contacts created in Mora to the Google address book.
  contactsWrite: 'https://www.googleapis.com/auth/contacts',
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  docsRead: 'https://www.googleapis.com/auth/documents.readonly',
} as const;

export class GoogleReauthRequiredError extends Error {
  readonly code = 'google_reauth_required';
}

export class GoogleNotConnectedError extends Error {
  readonly code = 'google_not_connected';
}

/**
 * One Google OAuth grant per user (Calendar today, Gmail/Docs later on the
 * same grant). The refresh token is stored encrypted; access tokens are only
 * kept in memory and refreshed on demand. The OAuth `state` is an HMAC-signed,
 * time-limited token that binds the callback to the user who started it, so a
 * callback cannot be replayed onto another account.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    const google = this.config.get<{ clientId?: string; clientSecret?: string; redirectUri?: string }>('app.google');
    return Boolean(google?.clientId && google?.clientSecret && google?.redirectUri);
  }

  createAuthUrl(userId: string): string {
    this.assertConfigured();
    const google = this.google();
    const state = this.signState(userId);
    const params = new URLSearchParams({
      client_id: google.clientId!,
      redirect_uri: google.redirectUri!,
      response_type: 'code',
      scope: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.gmailRead, GOOGLE_SCOPES.gmailSend, GOOGLE_SCOPES.contactsWrite, GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.docsRead, GOOGLE_SCOPES.email].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{ googleEmail: string }> {
    this.assertConfigured();
    const userId = this.verifyState(state);
    const google = this.google();

    const tokens = await this.postForm(TOKEN_URL, {
      code,
      client_id: google.clientId!,
      client_secret: google.clientSecret!,
      redirect_uri: google.redirectUri!,
      grant_type: 'authorization_code',
    });
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google did not return a refresh token; reconnect with consent.');
    }

    const googleEmail = await this.fetchEmail(tokens.access_token);
    const scopes = String(tokens.scope ?? '').split(' ').filter(Boolean);
    const encrypted = this.encryption.encryptSecret(tokens.refresh_token);

    const previous = await this.prisma.googleAccount.findUnique({ where: { userId } });
    const mergedScopes = [...new Set([...(previous?.scopes ?? []), ...scopes])];

    await this.prisma.googleAccount.upsert({
      where: { userId },
      create: {
        userId,
        googleEmail,
        scopes: mergedScopes,
        ...this.toColumns(encrypted),
      },
      update: {
        googleEmail,
        scopes: mergedScopes,
        ...this.toColumns(encrypted),
      },
    });

    this.accessTokens.set(userId, {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 - ACCESS_TOKEN_SAFETY_MS,
    });
    return { googleEmail };
  }

  async getStatus(userId: string): Promise<{ connected: boolean; googleEmail: string | null; scopes: string[] }> {
    const account = await this.prisma.googleAccount.findUnique({ where: { userId } });
    return {
      connected: Boolean(account),
      googleEmail: account?.googleEmail ?? null,
      scopes: account?.scopes ?? [],
    };
  }

  async getAccessToken(userId: string): Promise<string> {
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const account = await this.prisma.googleAccount.findUnique({ where: { userId } });
    if (!account) throw new GoogleNotConnectedError('Google account not connected');
    this.assertConfigured();
    const google = this.google();

    const refreshToken = this.encryption.decryptSecret(this.fromColumns(account));
    let tokens: { access_token: string; expires_in?: number };
    try {
      tokens = await this.postForm(TOKEN_URL, {
        client_id: google.clientId!,
        client_secret: google.clientSecret!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('invalid_grant')) {
        throw new GoogleReauthRequiredError('Google access was revoked or expired; reconnect the account');
      }
      throw error;
    }

    this.accessTokens.set(userId, {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 - ACCESS_TOKEN_SAFETY_MS,
    });
    return tokens.access_token;
  }

  /** Best-effort revocation at Google, then local deletion. Idempotent. */
  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    const account = await this.prisma.googleAccount.findUnique({ where: { userId } });
    if (!account) return { disconnected: false };

    try {
      const refreshToken = this.encryption.decryptSecret(this.fromColumns(account));
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
    } catch (error) {
      this.logger.warn(`Google token revocation failed (deleting locally anyway): ${String(error)}`);
    }

    await this.prisma.googleAccount.delete({ where: { userId } });
    this.accessTokens.delete(userId);
    return { disconnected: true };
  }

  private signState(userId: string): string {
    const nonce = randomBytes(16).toString('hex');
    const payload = `${userId}.${Date.now()}.${nonce}`;
    const signature = this.hmac(payload);
    return Buffer.from(`${payload}.${signature}`).toString('base64url');
  }

  private verifyState(state: string): string {
    const raw = Buffer.from(state, 'base64url').toString('utf8');
    const parts = raw.split('.');
    if (parts.length !== 4) throw new UnauthorizedException('Invalid OAuth state');
    const [userId, issuedAt, nonce, signature] = parts;
    const payload = `${userId}.${issuedAt}.${nonce}`;
    const expected = Buffer.from(this.hmac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (Date.now() - Number(issuedAt) > STATE_MAX_AGE_MS) {
      throw new UnauthorizedException('OAuth state expired');
    }
    return userId;
  }

  private hmac(payload: string): string {
    const key = this.config.get<string>('app.encryptionKey');
    if (!key) throw new ServiceUnavailableException('MORA_ENCRYPTION_KEY is required for Google OAuth');
    return createHmac('sha256', key).update(payload).digest('hex');
  }

  private async fetchEmail(accessToken: string): Promise<string> {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new BadRequestException('Could not read the Google account email');
    const body = (await res.json()) as { email?: string };
    if (!body.email) throw new BadRequestException('Google account has no email');
    return body.email;
  }

  private async postForm(url: string, fields: Record<string, string>): Promise<{
    access_token: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Google token endpoint ${res.status}: ${body.error ?? 'unknown_error'}`);
    }
    return body as { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Google OAuth is not configured on this server');
    }
  }

  private google() {
    return this.config.get<{ clientId?: string; clientSecret?: string; redirectUri?: string }>('app.google') ?? {};
  }

  private toColumns(secret: EncryptedSecret) {
    return {
      refreshTokenEncrypted: secret.ciphertext,
      refreshTokenIv: secret.iv,
      refreshTokenAuthTag: secret.authTag,
    };
  }

  private fromColumns(account: { refreshTokenEncrypted: string; refreshTokenIv: string; refreshTokenAuthTag: string }): EncryptedSecret {
    return {
      ciphertext: account.refreshTokenEncrypted,
      iv: account.refreshTokenIv,
      authTag: account.refreshTokenAuthTag,
      version: 1,
    };
  }
}
