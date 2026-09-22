import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { RouterDecisionsService } from './router-decisions.service.js';

@ApiTags('router-decisions')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('router-decisions')
export class RouterDecisionsController {
  constructor(private readonly routerDecisionsService: RouterDecisionsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.routerDecisionsService.listForUser(user.id);
  }
}
