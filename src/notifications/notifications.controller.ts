import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto.js';
import { NotificationService } from './notification.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationService.list(user.id, query.status);
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationService.markRead(user.id, id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notificationService.markAllRead(user.id);
    return { markedRead: count };
  }
}
