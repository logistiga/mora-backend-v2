import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GOOGLE_CONTACTS_SYNC_QUEUE, GoogleContactsSyncProcessor } from './google-contacts-sync.processor.js';
import { GoogleContactsRemoteProcessor } from './google-contacts-remote.processor.js';
import { CONTACT_REMOTE_QUEUE } from '../contacts/contact-remote.constants.js';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleContactsPushService } from './google-contacts-push.service.js';
import { GoogleDocsService } from './google-docs.service.js';
import { GoogleCalendarProvider } from './google-calendar.provider.js';
import { GoogleGmailEmailProvider } from './google-gmail.provider.js';
import { GoogleGmailAccountService } from './google-gmail-account.service.js';
import { GoogleController } from './google.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    AiProvidersModule,
    ContactsModule,
    BullModule.registerQueue({ name: GOOGLE_CONTACTS_SYNC_QUEUE }),
    BullModule.registerQueue({ name: CONTACT_REMOTE_QUEUE }),
  ],
  controllers: [GoogleController],
  providers: [
    GoogleOAuthService,
    GoogleCalendarProvider,
    GoogleGmailEmailProvider,
    GoogleGmailAccountService,
    GoogleContactsSyncService,
    GoogleContactsPushService,
    GoogleContactsSyncProcessor,
    GoogleContactsRemoteProcessor,
    GoogleDocsService,
  ],
  exports: [GoogleOAuthService, GoogleCalendarProvider, GoogleGmailEmailProvider],
})
export class GoogleModule {}
