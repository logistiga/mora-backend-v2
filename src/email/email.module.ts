import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { EmailAccountService } from './email-account.service.js';
import { EmailController } from './email.controller.js';
import { EmailMessageService } from './email-message.service.js';
import { ImapSmtpEmailProvider } from './providers/imap-smtp-email.provider.js';
import { EMAIL_PROVIDER } from './providers/email-provider.token.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), AiProvidersModule, ContactsModule, AuditModule],
  controllers: [EmailController],
  providers: [{ provide: EMAIL_PROVIDER, useClass: ImapSmtpEmailProvider }, EmailAccountService, EmailMessageService],
  exports: [EmailAccountService, EmailMessageService, EMAIL_PROVIDER],
})
export class EmailModule {}
