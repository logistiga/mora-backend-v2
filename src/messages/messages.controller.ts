import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { MoraOrchestratorService, type OrchestratorResult } from '../orchestrator/mora-orchestrator.service.js';
import { UsersService } from '../users/users.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly orchestrator: MoraOrchestratorService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Mora response with routing metadata' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMessageDto,
  ): Promise<OrchestratorResult> {
    const fullUser = await this.usersService.findById(user.id);
    return this.orchestrator.handleMessage({
      user: {
        id: user.id,
        email: user.email,
        displayName: fullUser?.displayName ?? user.email,
      },
      message: dto.message,
      conversationId: dto.conversationId,
    });
  }
}
