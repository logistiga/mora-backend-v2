import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../entities/token-payload.interface.js';
import { ApiKeyService } from './api-key.service.js';

class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

/**
 * Key management is reserved for a normal login session: an API key cannot
 * mint or revoke other keys, so a leaked key cannot escalate by itself.
 */
@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt-access'))
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(user.id, dto.name);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeys.list(user.id);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.apiKeys.revoke(user.id, id);
  }
}
