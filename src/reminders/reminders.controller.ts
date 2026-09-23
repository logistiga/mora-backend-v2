import { Controller, Get, Param, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { ListRemindersQueryDto } from './dto/list-reminders.dto.js';
import { ReminderService } from './reminder.service.js';

@ApiTags('reminders')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminderService: ReminderService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRemindersQueryDto) {
    return this.reminderService.list(user.id, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reminderService.getById(user.id, id);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReminderDto) {
    return this.reminderService.create(user.id, dto, 'manual');
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reminderService.cancel(user.id, id);
  }
}
