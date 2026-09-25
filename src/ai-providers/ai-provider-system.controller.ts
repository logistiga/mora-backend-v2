import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { AiProviderService } from './ai-provider.service.js';
import { CreateAiProviderDto } from './dto/create-ai-provider.dto.js';
import { ListAiProvidersQueryDto } from './dto/list-ai-providers.dto.js';
import { UpdateAiProviderDto } from './dto/update-ai-provider.dto.js';

/**
 * ADMIN-only management of SYSTEM providers (`ai_providers.user_id IS NULL`):
 * the shared Mora credentials every user falls back to when they have no
 * personal (BYOK) provider. Kept on a dedicated route rather than an
 * `isSystem` flag on `/ai-providers` so the authorization rule is structural:
 * every write below is behind `RolesGuard` + `@Roles('ADMIN')`, and the
 * user-facing controller passes a user id that can never match a SYSTEM row.
 *
 * Registered before AiProviderController in AiProvidersModule so `system` is
 * never captured by the `/ai-providers/:id` param route.
 */
@ApiTags('ai-providers-system')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
@Controller('ai-providers/system')
export class AiProviderSystemController {
  constructor(private readonly aiProviderService: AiProviderService) {}

  @Get()
  @ApiOperation({ summary: 'List SYSTEM providers (ADMIN only)' })
  async list(@Query() query: ListAiProvidersQueryDto) {
    return this.aiProviderService.listSystem(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one SYSTEM provider (ADMIN only)' })
  async getOne(@Param('id') id: string) {
    return this.aiProviderService.getOne(null, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a SYSTEM provider (ADMIN only)',
    description: 'The plaintext apiKey is encrypted (AES-256-GCM) on receipt and never returned.',
  })
  async create(@Body() dto: CreateAiProviderDto) {
    return this.aiProviderService.create(null, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a SYSTEM provider (ADMIN only)' })
  async update(@Param('id') id: string, @Body() dto: UpdateAiProviderDto) {
    return this.aiProviderService.update(null, id, dto);
  }

  @Post(':id/enable')
  async enable(@Param('id') id: string) {
    return this.aiProviderService.enable(null, id);
  }

  @Post(':id/disable')
  async disable(@Param('id') id: string) {
    return this.aiProviderService.disable(null, id);
  }

  @Post(':id/set-default')
  async setDefault(@Param('id') id: string) {
    return this.aiProviderService.setDefault(null, id);
  }

  @Post(':id/test')
  async test(@Param('id') id: string) {
    return this.aiProviderService.testConnection(null, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.aiProviderService.delete(null, id);
  }
}
