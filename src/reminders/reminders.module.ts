import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { REMINDER_DELIVERY_QUEUE } from './queue/reminder-queue.constants.js';
import { ReminderDeliveryProcessor } from './queue/processors/reminder-delivery.processor.js';
import { ReminderService } from './reminder.service.js';
import { RemindersController } from './reminders.controller.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: REMINDER_DELIVERY_QUEUE }),
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
  ],
  controllers: [RemindersController],
  providers: [ReminderService, ReminderDeliveryProcessor],
  exports: [ReminderService],
})
export class RemindersModule {}
