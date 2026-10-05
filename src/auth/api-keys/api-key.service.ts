import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../entities/token-payload.interface.js';

export const API_KEY_PREFIX = 'mora_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string): Promise<{ id: string; name: string; key: string; keyPrefix: string }> {
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.apiKey.create({
      data: { userId, name, keyPrefix: key.slice(0, 12), keyHash: hashApiKey(key) },
    });
    return { id: row.id, name: row.name, key, keyPrefix: row.keyPrefix };
  }

  list(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string): Promise<{ id: string; revoked: true }> {
    const row = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: row.revokedAt ?? new Date() } });
    return { id, revoked: true };
  }

  /** Owner of an active key, or null. Never reveals why a key was refused. */
  async authenticate(key: string): Promise<AuthenticatedUser | null> {
    if (!key.startsWith(API_KEY_PREFIX)) return null;
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });
    if (!row || row.revokedAt || !row.user.isActive) return null;
    await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return { id: row.user.id, email: row.user.email, role: row.user.role };
  }
}
