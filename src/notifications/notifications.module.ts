import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificationService } from './notification.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
