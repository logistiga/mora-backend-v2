import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiProviderService } from '../ai-providers/ai-provider.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { TimeContextService } from '../common/time/time-context.service.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateVoiceSessionDto } from './dto/create-voice-session.dto.js';
import { CreateVoiceProfileDto, UpdateVoiceProfileDto } from './dto/voice-profile.dto.js';
import { VoiceProviderResolverService } from './providers/voice-provider-resolver.service.js';
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
    private readonly voiceProviderResolver: VoiceProviderResolverService,
    private readonly timeContext: TimeContextService,
  ) {}

  @Post('sessions')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
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

  /**
   * Reports STT/TTS provider configuration (no secrets) plus protocol/audio-
   * format contract for the frontend. `sttConfigured`/`ttsConfigured`
   * reflect what will ACTUALLY resolve at turn time — including
   * VoiceProviderResolverService's fallback to the user's `chat` OpenAI
   * credentials when no dedicated `stt`/`tts` AiProvider row exists. Fixed
   * during Phase G validation: this previously delegated straight to
   * AiProviderService.getStatus(), which only checks for dedicated
   * kind='stt'/'tts' rows and so under-reported `false` for a user who only
   * has a `chat` provider, even though the resolver's fallback made voice
   * genuinely usable for them.
   */
  @Get('status')
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    const providerStatus = await this.aiProviderService.getStatus(user.id);
    const defaults = providerStatus.defaults as Record<string, { id: string; name: string; provider: string; model: string } | null>;

    const [sttConnection, ttsConnection] = await Promise.all([
      this.voiceProviderResolver.resolve(user.id, 'stt'),
      this.voiceProviderResolver.resolve(user.id, 'tts'),
    ]);

    return {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      audioFormat: VOICE_AUDIO_FORMAT,
      sttConfigured: sttConnection !== null,
      ttsConfigured: ttsConnection !== null,
      providers: { stt: defaults.stt ?? null, tts: defaults.tts ?? null },
    };
  }
}
