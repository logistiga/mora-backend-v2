import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { AiProviderService } from './ai-provider.service.js';
import { CreateAiProviderDto } from './dto/create-ai-provider.dto.js';
import { ListAiProvidersQueryDto } from './dto/list-ai-providers.dto.js';
import { UpdateAiProviderDto } from './dto/update-ai-provider.dto.js';

@ApiTags('ai-providers')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('ai-providers')
export class AiProviderController {
  constructor(private readonly aiProviderService: AiProviderService) {}

  // Registered before ':id' so "status" is never swallowed as an id param.
  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.aiProviderService.getStatus(user.id);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAiProvidersQueryDto) {
    return this.aiProviderService.list(user.id, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiProviderService.get(user.id, id);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAiProviderDto) {
    return this.aiProviderService.create(user.id, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAiProviderDto,
  ) {
    return this.aiProviderService.update(user.id, id, dto);
  }

  @Post(':id/enable')
  async enable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiProviderService.enable(user.id, id);
  }

  @Post(':id/disable')
  async disable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiProviderService.disable(user.id, id);
  }

  @Post(':id/set-default')
  async setDefault(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiProviderService.setDefault(user.id, id);
  }

  @Post(':id/test')
  async test(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiProviderService.testConnection(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.aiProviderService.delete(user.id, id);
  }
}
