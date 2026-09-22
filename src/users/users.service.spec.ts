import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const prismaMock = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('findByEmail delegates to prisma.user.findUnique', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.com' });

    const result = await service.findByEmail('a@b.com');

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(result).toEqual({ id: '1', email: 'a@b.com' });
  });

  it('create() throws ConflictException when the email is already taken', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.com' });

    await expect(
      service.create({ email: 'a@b.com', passwordHash: 'x'.repeat(60), displayName: 'A' }),
    ).rejects.toThrow(ConflictException);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('create() persists a new user when the email is free', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: '2', email: 'new@b.com' });

    const result = await service.create({
      email: 'new@b.com',
      passwordHash: 'x'.repeat(60),
      displayName: 'New',
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { email: 'new@b.com', passwordHash: 'x'.repeat(60), displayName: 'New' },
    });
    expect(result).toEqual({ id: '2', email: 'new@b.com' });
  });
});
