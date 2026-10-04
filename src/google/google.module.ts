import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { GoogleCalendarProvider } from './google-calendar.provider.js';
import { GoogleController } from './google.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), AiProvidersModule],
  controllers: [GoogleController],
  providers: [GoogleOAuthService, GoogleCalendarProvider],
  exports: [GoogleOAuthService, GoogleCalendarProvider],
})
export class GoogleModule {}
