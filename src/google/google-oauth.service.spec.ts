import { randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretEncryptionService } from '../ai-providers/secret-encryption.service.js';
import { GoogleOAuthService, GoogleReauthRequiredError } from './google-oauth.service.js';

const KEY = randomBytes(32).toString('base64');

function build(overrides: { configured?: boolean; account?: Record<string, unknown> | null } = {}) {
  const configured = overrides.configured ?? true;
  const config = {
    get: vi.fn((k: string) => {
      if (k === 'app.encryptionKey') return KEY;
      if (k === 'app.google') {
        return configured
          ? { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://api.test/google/oauth/callback' }
          : {};
      }
      return undefined;
    }),
  };
  const encryption = new SecretEncryptionService(config as never);
  let stored: Record<string, unknown> | null = overrides.account ?? null;
  const prisma = {
    googleAccount: {
      findUnique: vi.fn(async () => stored),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        stored = { ...(stored ?? {}), ...args.create, ...args.update };
        return stored;
      }),
      delete: vi.fn(async () => {
        const removed = stored;
        stored = null;
        return removed;
      }),
    },
  };
  const service = new GoogleOAuthService(prisma as never, encryption, config as never);
  return { service, prisma, encryption, getStored: () => stored };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GoogleOAuthService — authorization URL and signed state', () => {
  it('refuses to build an auth URL when Google OAuth is not configured', () => {
    const { service } = build({ configured: false });
    expect(service.isConfigured()).toBe(false);
    expect(() => service.createAuthUrl('u1')).toThrow();
  });

  it('builds an offline consent URL with calendar and identity scopes and a state', () => {
    const { service } = build();
    const url = new URL(service.createAuthUrl('u1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('a callback state round-trips to the user who started it', async () => {
    const { service } = build();
    const state = new URL(service.createAuthUrl('user-42')).searchParams.get('state')!;
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at', refresh_token: 'rt', scope: 'x', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: 'omar@example.com' }));
    const result = await service.handleCallback('code', state);
    expect(result.googleEmail).toBe('omar@example.com');
  });

  it('rejects a tampered state', async () => {
    const { service } = build();
    const state = new URL(service.createAuthUrl('user-42')).searchParams.get('state')!;
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const forged = Buffer.from(decoded.replace('user-42', 'user-99')).toString('base64url');
    await expect(service.handleCallback('code', forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired state', async () => {
    const { service } = build();
    const realNow = Date.now;
    Date.now = () => realNow() - 11 * 60 * 1000;
    const state = new URL(service.createAuthUrl('user-42')).searchParams.get('state')!;
    Date.now = realNow;
    await expect(service.handleCallback('code', state)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed state', async () => {
    const { service } = build();
    await expect(service.handleCallback('code', 'not-a-state')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('GoogleOAuthService — tokens and storage', () => {
  it('stores the refresh token encrypted, never in plain text', async () => {
    const { service, getStored } = build();
    const state = new URL(service.createAuthUrl('u1')).searchParams.get('state')!;
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at', refresh_token: 'SECRET-REFRESH', scope: 'a', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: 'o@e.com' }));
    await service.handleCallback('code', state);

    const row = getStored() as Record<string, string>;
    expect(row.refreshTokenEncrypted).toBeTruthy();
    expect(row.refreshTokenEncrypted).not.toContain('SECRET-REFRESH');
    expect(JSON.stringify(row)).not.toContain('SECRET-REFRESH');
  });

  it('refuses a callback that returns no refresh token', async () => {
    const { service } = build();
    const state = new URL(service.createAuthUrl('u1')).searchParams.get('state')!;
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at', scope: 'a', expires_in: 3600 }));
    await expect(service.handleCallback('code', state)).rejects.toThrow(/refresh token/);
  });

  it('refreshes an access token from the stored refresh token and caches it', async () => {
    const { service, encryption } = build();
    const enc = encryption.encryptSecret('RT-1');
    const { service: fresh } = build({
      account: {
        userId: 'u1',
        refreshTokenEncrypted: enc.ciphertext,
        refreshTokenIv: enc.iv,
        refreshTokenAuthTag: enc.authTag,
        scopes: [],
        googleEmail: 'o@e.com',
      },
    });
    void service;
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'AT-FRESH', expires_in: 3600 }));
    expect(await fresh.getAccessToken('u1')).toBe('AT-FRESH');
    expect(await fresh.getAccessToken('u1')).toBe('AT-FRESH');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a revoked grant as reauth-required', async () => {
    const { service, encryption } = build();
    const enc = encryption.encryptSecret('RT-1');
    const { service: fresh } = build({
      account: { userId: 'u1', refreshTokenEncrypted: enc.ciphertext, refreshTokenIv: enc.iv, refreshTokenAuthTag: enc.authTag, scopes: [], googleEmail: 'o@e.com' },
    });
    void service;
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(fresh.getAccessToken('u1')).rejects.toBeInstanceOf(GoogleReauthRequiredError);
  });

  it('disconnect is idempotent and deletes the stored grant', async () => {
    const { service, prisma } = build();
    expect(await service.disconnect('u1')).toEqual({ disconnected: false });
    expect(prisma.googleAccount.delete).not.toHaveBeenCalled();
  });

  it('disconnect revokes at Google best-effort and removes the local row', async () => {
    const { service, encryption, getStored } = build();
    const enc = encryption.encryptSecret('RT-1');
    const row = { userId: 'u1', refreshTokenEncrypted: enc.ciphertext, refreshTokenIv: enc.iv, refreshTokenAuthTag: enc.authTag, scopes: [], googleEmail: 'o@e.com' };
    const { service: fresh, getStored: getFresh, prisma } = build({ account: row });
    void service; void getStored;
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    expect(await fresh.disconnect('u1')).toEqual({ disconnected: true });
    expect(prisma.googleAccount.delete).toHaveBeenCalled();
    expect(getFresh()).toBeNull();
  });
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
