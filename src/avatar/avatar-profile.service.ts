import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AvatarProfile, Prisma } from '../generated/prisma/client.js';
import type { UpdateAvatarProfileDto } from './dto/avatar-profile.dto.js';
import type { AvatarProfileView } from './avatar.types.js';

@Injectable()
export class AvatarProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(userId: string): Promise<AvatarProfileView> {
    const existing = await this.prisma.avatarProfile.findUnique({ where: { userId } });
    if (existing) return toView(existing);

    const created = await this.prisma.avatarProfile.create({
      data: {
        userId,
        settings: { realtimeTransport: 'voice_ws' } as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      userId,
      action: 'avatar_profile_initialized',
      metadata: { avatarProfileId: created.id, renderMode: created.renderMode, lipSyncMode: created.lipSyncMode },
    });

    return toView(created);
  }

  async update(userId: string, dto: UpdateAvatarProfileDto): Promise<AvatarProfileView> {
    const existing = await this.prisma.avatarProfile.findUnique({ where: { userId } });
    const row = existing
      ? await this.prisma.avatarProfile.update({
          where: { userId },
          data: {
            name: dto.name,
            avatarPreset: dto.avatarPreset,
            renderMode: dto.renderMode,
            baseExpression: dto.baseExpression,
            expressionIntensity: dto.expressionIntensity,
            lipSyncMode: dto.lipSyncMode,
            voiceSyncEnabled: dto.voiceSyncEnabled,
            idleEnabled: dto.idleEnabled,
            reducedMotion: dto.reducedMotion,
            settings: dto.settings as Prisma.InputJsonValue | undefined,
          },
        })
      : await this.prisma.avatarProfile.create({
          data: {
            userId,
            name: dto.name ?? 'Mora Core',
            avatarPreset: dto.avatarPreset ?? 'mora_core',
            renderMode: dto.renderMode ?? 'expressive_orb',
            baseExpression: dto.baseExpression ?? 'neutral',
            expressionIntensity: dto.expressionIntensity ?? 0.7,
            lipSyncMode: dto.lipSyncMode ?? 'viseme_timeline',
            voiceSyncEnabled: dto.voiceSyncEnabled ?? true,
            idleEnabled: dto.idleEnabled ?? true,
            reducedMotion: dto.reducedMotion ?? false,
            settings: (dto.settings ?? { realtimeTransport: 'voice_ws' }) as Prisma.InputJsonValue,
          },
        });

    await this.audit.log({
      userId,
      action: 'avatar_profile_updated',
      metadata: {
        avatarProfileId: row.id,
        renderMode: row.renderMode,
        lipSyncMode: row.lipSyncMode,
        voiceSyncEnabled: row.voiceSyncEnabled,
        reducedMotion: row.reducedMotion,
      },
    });

    return toView(row);
  }
}

function toView(row: AvatarProfile): AvatarProfileView {
  return {
    id: row.id,
    name: row.name,
    avatarPreset: row.avatarPreset,
    renderMode: row.renderMode as AvatarProfileView['renderMode'],
    baseExpression: row.baseExpression as AvatarProfileView['baseExpression'],
    expressionIntensity: row.expressionIntensity,
    lipSyncMode: row.lipSyncMode as AvatarProfileView['lipSyncMode'],
    voiceSyncEnabled: row.voiceSyncEnabled,
    idleEnabled: row.idleEnabled,
    reducedMotion: row.reducedMotion,
    settings:
      row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
