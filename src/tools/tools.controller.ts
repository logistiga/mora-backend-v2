import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ToolRegistryService } from './tool-registry.service.js';

export interface ToolDiscoveryView {
  name: string;
  description: string;
  securityLevel: string;
  requiresConfirmation: boolean;
  allowedScopes: readonly string[];
}

/**
 * Public metadata only — never the tool's internal code/handler, never a
 * secret (AGENTS Phase D §26). Behind auth because tool availability can
 * eventually be user/plan-dependent, though Phase D's catalog is the same
 * for every authenticated user.
 */
@ApiTags('tools')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('tools')
export class ToolsController {
  constructor(private readonly registry: ToolRegistryService) {}

  @Get()
  async list(): Promise<ToolDiscoveryView[]> {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      securityLevel: tool.securityLevel,
      requiresConfirmation: tool.requiresConfirmation,
      allowedScopes: tool.allowedScopes,
    }));
  }
}
