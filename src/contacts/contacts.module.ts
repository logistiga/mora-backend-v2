import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ContactService } from './contact.service.js';
import { ContactsController } from './contacts.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [ContactsController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactsModule {}
