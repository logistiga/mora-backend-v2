import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ContactService } from './contact.service.js';
import { ContactsController } from './contacts.controller.js';
import { CONTACT_REMOTE_QUEUE } from './contact-remote.constants.js';
import { ContactRemoteSyncService } from './contact-remote-sync.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), BullModule.registerQueue({ name: CONTACT_REMOTE_QUEUE })],
  controllers: [ContactsController],
  providers: [ContactService, ContactRemoteSyncService],
  exports: [ContactService, ContactRemoteSyncService],
})
export class ContactsModule {}
