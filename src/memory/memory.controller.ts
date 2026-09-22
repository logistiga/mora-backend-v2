import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateMemoryDto } from './dto/create-memory.dto.js';
import { ListMemoriesQueryDto } from './dto/list-memories.dto.js';
import { UpdateMemoryDto } from './dto/update-memory.dto.js';
import { MemoryService } from './memory.service.js';

@ApiTags('memories')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMemoriesQueryDto) {
    return this.memoryService.list(user.id, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.memoryService.getById(user.id, id);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMemoryDto) {
    return this.memoryService.create(user.id, dto, 'manual');
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
  ) {
    return this.memoryService.update(user.id, id, dto);
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.memoryService.archive(user.id, id);
  }
}
