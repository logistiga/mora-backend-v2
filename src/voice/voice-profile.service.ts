import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { VoiceProfile } from '../generated/prisma/client.js';

export interface CreateVoiceProfileParams {
  userId: string;
  name: string;
  provider: string;
  voiceId: string;
  language?: string;
  speed?: number;
  isDefault?: boolean;
}

export interface UpdateVoiceProfileParams {
  name?: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  isDefault?: boolean;
}

/**
 * MoraVoiceProfile (AGENTS Phase F §15): name/provider/voiceId/language/
 * speed/settings only — never an API key (that stays exclusively on the
 * AiProvider row via VoiceProviderResolverService).
 */
@Injectable()
export class VoiceProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<VoiceProfile[]> {
    return this.prisma.voiceProfile.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async create(params: CreateVoiceProfileParams): Promise<VoiceProfile> {
    if (params.isDefault) {
      await this.prisma.voiceProfile.updateMany({ where: { userId: params.userId }, data: { isDefault: false } });
    }
    return this.prisma.voiceProfile.create({
      data: {
        userId: params.userId,
        name: params.name,
        provider: params.provider,
        voiceId: params.voiceId,
        language: params.language ?? 'auto',
        speed: params.speed ?? 1.0,
        isDefault: params.isDefault ?? false,
      },
    });
  }

  async update(userId: string, id: string, params: UpdateVoiceProfileParams): Promise<VoiceProfile> {
    const existing = await this.getOwned(userId, id);
    if (params.isDefault) {
      await this.prisma.voiceProfile.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return this.prisma.voiceProfile.update({
      where: { id: existing.id },
      data: {
        name: params.name,
        voiceId: params.voiceId,
        language: params.language,
        speed: params.speed,
        isDefault: params.isDefault,
      },
    });
  }

  async getDefault(userId: string): Promise<VoiceProfile | null> {
    return this.prisma.voiceProfile.findFirst({ where: { userId, isDefault: true } });
  }

  private async getOwned(userId: string, id: string): Promise<VoiceProfile> {
    const row = await this.prisma.voiceProfile.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Voice profile not found');
    if (row.userId !== userId) throw new ForbiddenException('This voice profile does not belong to you');
    return row;
  }
}
