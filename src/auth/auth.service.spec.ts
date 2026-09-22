import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

vi.mock('bcrypt', () => ({
  hash: vi.fn(async () => 'hashed'),
  compare: vi.fn(async () => true),
}));

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    findByEmail: vi.fn(),
    create: vi.fn(),
  };
  const prismaMock = {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const jwtServiceMock = {
    signAsync: vi.fn(async () => 'signed.jwt.token'),
  };
  const configServiceMock = {
    get: vi.fn(() => ({
      accessSecret: 'a'.repeat(32),
      accessExpiresIn: '15m',
      refreshSecret: 'b'.repeat(32),
      refreshExpiresIn: '7d',
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (bcrypt.hash as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('hashed');
    (bcrypt.compare as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    jwtServiceMock.signAsync.mockResolvedValue('signed.jwt.token');

    service = new AuthService(
      usersServiceMock as unknown as UsersService,
      prismaMock as unknown as PrismaService,
      jwtServiceMock as never,
      configServiceMock as never,
    );
  });

  describe('register', () => {
    it('hashes the password, creates the user, and issues a token pair', async () => {
      usersServiceMock.create.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        role: 'USER',
      });

      const result = await service.register({
        email: 'a@b.com',
        password: 'password123',
        displayName: 'A',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(usersServiceMock.create).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'signed.jwt.token', refreshToken: 'signed.jwt.token' });
      expect(prismaMock.refreshToken.create).toHaveBeenCalledOnce();
    });
  });

  describe('login', () => {
    it('rejects unknown emails', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@b.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects inactive users', async () => {
      usersServiceMock.findByEmail.mockResolvedValue({ id: 'u1', isActive: false });

      await expect(
        service.login({ email: 'a@b.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      usersServiceMock.findByEmail.mockResolvedValue({
        id: 'u1',
        isActive: true,
        passwordHash: 'hashed',
      });
      (bcrypt.compare as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues a token pair for valid credentials', async () => {
      usersServiceMock.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        role: 'USER',
        isActive: true,
        passwordHash: 'hashed',
      });

      const result = await service.login({ email: 'a@b.com', password: 'correct' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
    });
  });

  describe('refresh', () => {
    it('rejects when no stored token matches the jti', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.refresh({ sub: 'u1', jti: 'missing', type: 'refresh' }, 'raw-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a revoked token', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        tokenHash: 'hashed',
        user: { id: 'u1' },
      });

      await expect(
        service.refresh({ sub: 'u1', jti: 'rt1', type: 'refresh' }, 'raw-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rotates a valid token: revokes the old one and issues a new pair', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        tokenHash: 'hashed',
        user: { id: 'u1', email: 'a@b.com', role: 'USER' },
      });

      const result = await service.refresh(
        { sub: 'u1', jti: 'rt1', type: 'refresh' },
        'raw-token',
      );

      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });
});
