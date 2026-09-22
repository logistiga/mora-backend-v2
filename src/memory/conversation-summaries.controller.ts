import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ListConversationSummariesQueryDto } from './dto/list-conversation-summaries.dto.js';

@ApiTags('conversation-summaries')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('conversation-summaries')
export class ConversationSummariesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListConversationSummariesQueryDto,
  ) {
    // Always filtered by the authenticated user's own id — never a
    // client-supplied userId — and optionally narrowed to one conversation
    // (still ownership-scoped via the userId filter above).
    return this.prisma.conversationSummary.findMany({
      where: { userId: user.id, conversationId: query.conversationId },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
