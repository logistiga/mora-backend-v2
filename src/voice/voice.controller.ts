import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AiProviderService } from '../ai-providers/ai-provider.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { TimeContextService } from '../common/time/time-context.service.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateVoiceSessionDto } from './dto/create-voice-session.dto.js';
import { CreateVoiceProfileDto, UpdateVoiceProfileDto } from './dto/voice-profile.dto.js';
import { VoiceProfileService } from './voice-profile.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { VOICE_AUDIO_FORMAT, VOICE_PROTOCOL_VERSION } from './voice.types.js';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly sessionService: VoiceSessionService,
    private readonly profileService: VoiceProfileService,
    private readonly aiProviderService: AiProviderService,
    private readonly timeContext: TimeContextService,
  ) {}

  @Post('sessions')
  async createSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVoiceSessionDto) {
    return this.sessionService.create({
      userId: user.id,
      conversationId: dto.conversationId,
      scope: dto.scope,
      space: dto.space,
      language: dto.language ?? 'auto',
      mode: (dto.mode ?? 'push_to_talk') as 'push_to_talk' | 'wake_word' | 'continuous_session',
      timezone: dto.timezone ?? this.timeContext.timezone,
    });
  }

  @Get('sessions/:id')
  async getSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sessionService.getOwned(user.id, id);
  }

  @Post('sessions/:id/end')
  async endSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sessionService.end(user.id, id);
  }

  @Get('profiles')
  async listProfiles(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.list(user.id);
  }

  @Post('profiles')
  async createProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVoiceProfileDto) {
    return this.profileService.create({ userId: user.id, ...dto });
  }

  @Patch('profiles/:id')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateVoiceProfileDto,
  ) {
    return this.profileService.update(user.id, id, dto);
  }

  /** Reports STT/TTS provider configuration (no secrets) plus protocol/audio-format contract for the frontend. */
  @Get('status')
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    const providerStatus = await this.aiProviderService.getStatus(user.id);
    const defaults = providerStatus.defaults as Record<string, { id: string; name: string; provider: string; model: string } | null>;
    return {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      audioFormat: VOICE_AUDIO_FORMAT,
      sttConfigured: Boolean(providerStatus.sttConfigured),
      ttsConfigured: Boolean(providerStatus.ttsConfigured),
      providers: { stt: defaults.stt ?? null, tts: defaults.tts ?? null },
    };
  }
}
