import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { UpdateSkillDto } from './dto/update-skill.dto.js';
import { UserSkillsService } from './user-skills.service.js';

@ApiTags('skills')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('skills')
export class SkillsController {
  constructor(private readonly userSkills: UserSkillsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.userSkills.listForUser(user.id);
  }

  @Patch(':key')
  update(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() dto: UpdateSkillDto) {
    return this.userSkills.setEnabled(user.id, key, dto.enabled);
  }
}
