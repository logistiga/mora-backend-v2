import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { UserEntity } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: UserEntity })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserEntity> {
    const found = await this.usersService.findById(user.id);
    return new UserEntity(found!);
  }
}
