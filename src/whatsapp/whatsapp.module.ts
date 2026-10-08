import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { TimeModule } from '../common/time/time.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { WHATSAPP_MISSION_QUEUE } from './whatsapp-mission.constants.js';
import { WhatsAppMissionProcessor } from './whatsapp-mission.processor.js';
import { WhatsAppMissionService } from './whatsapp-mission.service.js';
import { EvolutionWhatsAppProvider } from './providers/evolution-whatsapp.provider.js';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.token.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    AiProvidersModule,
    ContactsModule,
    AuditModule,
    LlmModule,
    NotificationsModule,
    RemindersModule,
    TimeModule,
    BullModule.registerQueue({ name: WHATSAPP_MISSION_QUEUE }),
  ],
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [
    { provide: WHATSAPP_PROVIDER, useClass: EvolutionWhatsAppProvider },
    WhatsAppAccountService,
    WhatsAppMessageService,
    WhatsAppMissionService,
    WhatsAppMissionProcessor,
  ],
  exports: [WhatsAppAccountService, WhatsAppMessageService, WhatsAppMissionService, WHATSAPP_PROVIDER],
})
export class WhatsAppModule {}
