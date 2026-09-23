import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { EvolutionWhatsAppProvider } from './providers/evolution-whatsapp.provider.js';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.token.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), AiProvidersModule, ContactsModule, AuditModule],
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [
    { provide: WHATSAPP_PROVIDER, useClass: EvolutionWhatsAppProvider },
    WhatsAppAccountService,
    WhatsAppMessageService,
  ],
  exports: [WhatsAppAccountService, WhatsAppMessageService, WHATSAPP_PROVIDER],
})
export class WhatsAppModule {}
