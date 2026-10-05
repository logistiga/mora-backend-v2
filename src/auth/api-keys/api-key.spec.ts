import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyService, API_KEY_PREFIX, hashApiKey } from './api-key.service.js';
import { ApiKeyMiddleware } from './api-key.middleware.js';

function buildPrisma(row: Record<string, unknown> | null) {
  return {
    apiKey: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'k1', name: args.data.name, keyPrefix: args.data.keyPrefix })),
      findUnique: vi.fn(async () => row),
      findFirst: vi.fn(async () => row),
      update: vi.fn(async () => ({})),
    },
  };
}

describe('ApiKeyService', () => {
  it('creates a prefixed key and stores only its hash, never the key itself', async () => {
    const prisma = buildPrisma(null);
    const created = await new ApiKeyService(prisma as never).create('u1', 'ChatGPT');
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.key.length).toBeGreaterThan(40);
    const stored = prisma.apiKey.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(stored.keyHash).toBe(hashApiKey(created.key));
    expect(JSON.stringify(stored)).not.toContain(created.key);
  });

  it('accepts an active key of an active user', async () => {
    const row = { id: 'k1', revokedAt: null, user: { id: 'u1', email: 'o@x.com', role: 'ADMIN', isActive: true } };
    const user = await new ApiKeyService(buildPrisma(row) as never).authenticate(`${API_KEY_PREFIX}abc`);
    expect(user).toEqual({ id: 'u1', email: 'o@x.com', role: 'ADMIN' });
  });

  it('refuses a revoked key, a key of an inactive user, and any value without the mora_ prefix', async () => {
    const revoked = { id: 'k1', revokedAt: new Date(), user: { id: 'u1', email: 'a', role: 'USER', isActive: true } };
    expect(await new ApiKeyService(buildPrisma(revoked) as never).authenticate(`${API_KEY_PREFIX}x`)).toBeNull();
    const inactive = { id: 'k1', revokedAt: null, user: { id: 'u1', email: 'a', role: 'USER', isActive: false } };
    expect(await new ApiKeyService(buildPrisma(inactive) as never).authenticate(`${API_KEY_PREFIX}x`)).toBeNull();
    const prisma = buildPrisma(null);
    expect(await new ApiKeyService(prisma as never).authenticate('eyJhbGciOi.jwt.token')).toBeNull();
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('revoking a key you do not own is reported as not found', async () => {
    await expect(new ApiKeyService(buildPrisma(null) as never).revoke('u1', 'k-other')).rejects.toThrow('API key not found');
  });
});

describe('ApiKeyMiddleware', () => {
  const service = (result: unknown) => ({ authenticate: vi.fn(async () => result) });

  it('lets a request without any key pass through untouched', async () => {
    const next = vi.fn();
    const req: Record<string, unknown> = { headers: {} };
    await new ApiKeyMiddleware(service(null) as never).use(req as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
  });

  it('authenticates a valid X-Api-Key header and flags the request', async () => {
    const next = vi.fn();
    const req: Record<string, unknown> = { headers: { 'x-api-key': `${API_KEY_PREFIX}abc` } };
    const user = { id: 'u1', email: 'o', role: 'ADMIN' };
    await new ApiKeyMiddleware(service(user) as never).use(req as never, {} as never, next);
    expect(req.user).toEqual(user);
    expect(req.apiKeyAuthenticated).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses a present but invalid key instead of falling back to anonymous access', async () => {
    const next = vi.fn();
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${API_KEY_PREFIX}bad` } };
    await new ApiKeyMiddleware(service(null) as never).use(req as never, {} as never, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedException);
    expect(req.apiKeyAuthenticated).toBeUndefined();
  });

  it('ignores ordinary JWT bearer tokens (they are handled by the JWT strategy)', async () => {
    const next = vi.fn();
    const svc = service(null);
    await new ApiKeyMiddleware(svc as never).use({ headers: { authorization: 'Bearer eyJhbGciOi' } } as never, {} as never, next);
    expect(svc.authenticate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});
