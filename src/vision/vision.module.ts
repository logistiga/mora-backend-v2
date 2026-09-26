import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { UsersModule } from '../users/users.module.js';
import { VisionAnalysisService } from './vision-analysis.service.js';
import { VisionAssetService } from './vision-asset.service.js';
import { VisionController } from './vision.controller.js';
import { VisionService } from './vision.service.js';
import { OpenAiCompatibleVisionProvider } from './providers/openai-compatible-vision.provider.js';
import { VisionProviderRegistry } from './providers/vision-provider-registry.service.js';
import { VisionProviderResolverService } from './providers/vision-provider-resolver.service.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    AiProvidersModule,
    AuditModule,
    ConversationsModule,
    DocumentsModule,
    OrchestratorModule,
    UsersModule,
  ],
  controllers: [VisionController],
  providers: [
    VisionAssetService,
    VisionAnalysisService,
    VisionService,
    VisionProviderResolverService,
    VisionProviderRegistry,
    OpenAiCompatibleVisionProvider,
  ],
  exports: [VisionAssetService],
})
export class VisionModule {}
