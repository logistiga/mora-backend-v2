import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AvatarController } from './avatar.controller.js';
import { AvatarProfileService } from './avatar-profile.service.js';
import { AvatarStateService } from './avatar-state.service.js';

@Module({
  imports: [
    AiProvidersModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    JwtModule.register({}),
  ],
  controllers: [AvatarController],
  providers: [AvatarProfileService, AvatarStateService],
  exports: [AvatarProfileService, AvatarStateService],
})
export class AvatarModule {}
