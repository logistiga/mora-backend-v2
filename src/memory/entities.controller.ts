import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { EntitiesService } from './entities.service.js';
import { ListEntitiesQueryDto } from './dto/list-entities.dto.js';

@ApiTags('entities')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entitiesService: EntitiesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEntitiesQueryDto) {
    return this.entitiesService.list(user.id, query);
  }
}
