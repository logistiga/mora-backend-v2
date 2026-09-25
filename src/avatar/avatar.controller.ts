import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AiProviderService } from '../ai-providers/ai-provider.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { VOICE_PROTOCOL_VERSION } from '../voice/voice.types.js';
import { AvatarProfileService } from './avatar-profile.service.js';
import { UpdateAvatarProfileDto } from './dto/avatar-profile.dto.js';

@ApiTags('avatar')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('avatar')
export class AvatarController {
  constructor(
    private readonly profiles: AvatarProfileService,
    private readonly aiProviders: AiProviderService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getOrCreate(user.id);
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAvatarProfileDto) {
    return this.profiles.update(user.id, dto);
  }

  @Get('status')
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.profiles.getOrCreate(user.id);
    const provider = await this.aiProviders.getProviderForUseCase(user.id, { kind: 'avatar' });

    return {
      avatarConfigured: true,
      profile,
      provider: provider ? { id: provider.id, provider: provider.provider, model: provider.model, kind: provider.kind } : null,
      realtime: {
        websocketPath: '/voice/ws',
        protocolVersion: VOICE_PROTOCOL_VERSION,
        events: [
          'avatar.state',
          'assistant.expression',
          'avatar.lipsync',
          'assistant.speaking.started',
          'assistant.speaking.ended',
          'action.pending_confirmation',
          'session.interrupted',
        ],
      },
      features: {
        expressions: true,
        lipSync: true,
        confirmations: true,
        reconnectStates: true,
        multimodalState: true,
        voiceVision: true,
      },
      privacy: {
        autoCapture: false,
        backgroundScreenMonitoring: false,
        liveCameraRequiresExplicitUserAction: true,
      },
    };
  }
}
