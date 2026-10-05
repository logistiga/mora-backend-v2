import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleDocsService } from './google-docs.service.js';
import { GoogleCalendarProvider } from './google-calendar.provider.js';
import { GoogleGmailEmailProvider } from './google-gmail.provider.js';
import { GoogleGmailAccountService } from './google-gmail-account.service.js';
import { GoogleController } from './google.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), AiProvidersModule, ContactsModule],
  controllers: [GoogleController],
  providers: [GoogleOAuthService, GoogleCalendarProvider, GoogleGmailEmailProvider, GoogleGmailAccountService, GoogleContactsSyncService, GoogleDocsService],
  exports: [GoogleOAuthService, GoogleCalendarProvider, GoogleGmailEmailProvider],
})
export class GoogleModule {}
