import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { TimeModule } from '../common/time/time.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { PendingActionsModule } from '../pending-actions/pending-actions.module.js';
import { UsersModule } from '../users/users.module.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';
import { VoiceProviderFactoryService } from './providers/voice-provider-factory.service.js';
import { VoiceProviderResolverService } from './providers/voice-provider-resolver.service.js';
import { VoiceConfirmationService } from './voice-confirmation.service.js';
import { VoiceController } from './voice.controller.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceProfileService } from './voice-profile.service.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { VoiceSessionService } from './voice-session.service.js';
import { VoiceTurnRunnerService } from './voice-turn-runner.service.js';
import { VoiceTurnService } from './voice-turn.service.js';

/**
 * Phase F — Real-Time Voice Engine. Voice is a CHANNEL, not a new agent
 * (AGENTS Phase F §0): this module owns only session/turn/profile
 * persistence, STT/TTS provider adapters, VAD/EndOfTurn, and the WebSocket
 * transport — it imports OrchestratorModule and PendingActionsModule and
 * calls their EXISTING services unmodified rather than reimplementing
 * routing, memory, documents, tools, or confirmation logic.
 */
@Module({
  imports: [
    AiProvidersModule,
    UsersModule,
    OrchestratorModule,
    PendingActionsModule,
    TimeModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    JwtModule.register({}),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceSessionService,
    VoiceTurnService,
    VoiceProfileService,
    VoiceRuntimeRegistry,
    VoiceConfirmationService,
    VoiceProviderResolverService,
    VoiceProviderFactoryService,
    VoiceTurnRunnerService,
    EndOfTurnService,
    VoiceGateway,
  ],
  exports: [VoiceSessionService, VoiceTurnService, VoiceProfileService],
})
export class VoiceModule {}
