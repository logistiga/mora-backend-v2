import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { PendingActionService } from './pending-action.service.js';

@ApiTags('pending-actions')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('pending-actions')
export class PendingActionsController {
  constructor(private readonly pendingActionService: PendingActionService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.pendingActionService.list(user.id);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pendingActionService.getById(user.id, id);
  }

  @Post(':id/approve')
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pendingActionService.approve(user.id, id);
  }

  @Post(':id/reject')
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pendingActionService.reject(user.id, id);
  }
}
