import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactService } from './contact.service.js';

function buildService() {
  const prismaMock = {
    contact: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contactIdentity: { findUnique: vi.fn(), create: vi.fn() },
  };
  const service = new ContactService(prismaMock as never);
  return { service, prismaMock };
}

describe('ContactService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('getById() throws ForbiddenException for another user\'s contact', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue({ id: 'c1', userId: 'someone-else' });
    await expect(ctx.service.getById('u1', 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('getById() throws NotFoundException for a missing contact', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue(null);
    await expect(ctx.service.getById('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('addIdentity() normalizes an email to lowercase for dedup', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1' });
    ctx.prismaMock.contactIdentity.findUnique.mockResolvedValue(null);
    ctx.prismaMock.contactIdentity.create.mockResolvedValue({ id: 'i1' });

    await ctx.service.addIdentity('u1', 'c1', { type: 'email', value: 'Jean.TEST@Example.COM' });

    expect(ctx.prismaMock.contactIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ valueNormalized: 'jean.test@example.com' }) }),
    );
  });

  it('addIdentity() strips formatting from a WhatsApp number for dedup', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1' });
    ctx.prismaMock.contactIdentity.findUnique.mockResolvedValue(null);
    ctx.prismaMock.contactIdentity.create.mockResolvedValue({ id: 'i1' });

    await ctx.service.addIdentity('u1', 'c1', { type: 'whatsapp', value: '+33 6 12 34 56 78' });

    expect(ctx.prismaMock.contactIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ valueNormalized: '+33612345678' }) }),
    );
  });

  it('addIdentity() refuses to attach an identity already owned by a different contact', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue({ id: 'c2', userId: 'u1' });
    ctx.prismaMock.contactIdentity.findUnique.mockResolvedValue({ id: 'i1', contactId: 'c1-different' });

    await expect(ctx.service.addIdentity('u1', 'c2', { type: 'email', value: 'x@example.com' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('addIdentity() is idempotent: re-adding the same identity to the same contact is a no-op success', async () => {
    ctx.prismaMock.contact.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1' });
    const existing = { id: 'i1', contactId: 'c1' };
    ctx.prismaMock.contactIdentity.findUnique.mockResolvedValue(existing);

    const result = await ctx.service.addIdentity('u1', 'c1', { type: 'email', value: 'x@example.com' });
    expect(result).toBe(existing);
    expect(ctx.prismaMock.contactIdentity.create).not.toHaveBeenCalled();
  });

  it('findByIdentity() normalizes before lookup, returning null when nothing matches', async () => {
    ctx.prismaMock.contactIdentity.findUnique.mockResolvedValue(null);
    const result = await ctx.service.findByIdentity('u1', 'whatsapp', '+33 6 00 00 00 00');
    expect(result).toBeNull();
    expect(ctx.prismaMock.contactIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_type_valueNormalized: { userId: 'u1', type: 'whatsapp', valueNormalized: '+33600000000' } } }),
    );
  });
});
