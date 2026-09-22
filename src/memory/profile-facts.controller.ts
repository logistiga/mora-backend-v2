import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ListProfileFactsQueryDto } from './dto/list-profile-facts.dto.js';
import { ProfileFactsService } from './profile-facts.service.js';

@ApiTags('profile-facts')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('profile-facts')
export class ProfileFactsController {
  constructor(private readonly profileFactsService: ProfileFactsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProfileFactsQueryDto) {
    return this.profileFactsService.list(user.id, query);
  }
}
