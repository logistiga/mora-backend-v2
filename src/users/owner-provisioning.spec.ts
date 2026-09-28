import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_OWNER_PASSWORD_LENGTH, upsertOwner } from './owner-provisioning.js';

describe('upsertOwner', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  const hash = vi.fn(async () => 'bcrypt-hash');
  const strongPassword = 'x'.repeat(MIN_OWNER_PASSWORD_LENGTH);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'new-id', ...data }));
  });

  it('creates the owner as ADMIN with a hashed password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await upsertOwner(
      prisma as never,
      { email: ' owner@example.test ', password: strongPassword, displayName: 'Omar' },
      hash,
    );

    expect(result).toEqual({ id: 'new-id', email: 'owner@example.test', created: true, promoted: true });
    expect(hash).toHaveBeenCalledWith(strongPassword, 12);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'owner@example.test', passwordHash: 'bcrypt-hash', displayName: 'Omar', role: 'ADMIN' },
    });
  });

  it('promotes an existing account to ADMIN without touching its password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER', isActive: true });

    const result = await upsertOwner(prisma as never, { email: 'owner@example.test', password: strongPassword }, hash);

    expect(result).toEqual({ id: 'u1', email: 'owner@example.test', created: false, promoted: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN', isActive: true },
    });
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('is a no-op for an owner that is already an active ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true });

    const result = await upsertOwner(prisma as never, { email: 'owner@example.test' }, hash);

    expect(result.promoted).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ['missing email', { email: '' }],
    ['invalid email', { email: 'not-an-email', password: strongPassword }],
  ])('rejects %s', async (_label, input) => {
    await expect(upsertOwner(prisma as never, input, hash)).rejects.toThrow('MORA_OWNER_EMAIL');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses to create an owner without a strong enough password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      upsertOwner(prisma as never, { email: 'owner@example.test', password: 'short' }, hash),
    ).rejects.toThrow('MORA_OWNER_PASSWORD');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
