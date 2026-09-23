import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateEmailAccountDto } from './dto/create-email-account.dto.js';
import { EmailAccountService } from './email-account.service.js';
import { EmailMessageService } from './email-message.service.js';
import type { EmailProviderInterface } from './providers/email-provider.interface.js';
import { EMAIL_PROVIDER } from './providers/email-provider.token.js';

@ApiTags('email')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('email')
export class EmailController {
  constructor(
    private readonly accountService: EmailAccountService,
    private readonly messageService: EmailMessageService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProviderInterface,
  ) {}

  @Get('accounts')
  async listAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.accountService.list(user.id);
  }

  @Post('accounts')
  async createAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmailAccountDto) {
    return this.accountService.create(user.id, dto);
  }

  @Get('accounts/:id/health')
  async health(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.accountService.getOwnedRow(user.id, id);
    const connection = await this.accountService.resolveConnection(id);
    const result = await this.provider.checkHealth(connection);
    await this.accountService.updateHealth(id, result.connected ? 'connected' : 'error', result.error);
    return result;
  }

  @Post('accounts/:id/sync')
  async sync(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.accountService.getOwnedRow(user.id, id);
    const ingested = await this.messageService.syncInbound(user.id, id);
    return { ingested };
  }

  @Get('threads')
  async listThreads(@CurrentUser() user: AuthenticatedUser, @Query('accountId') accountId?: string) {
    const accounts = await this.accountService.list(user.id);
    const accountIds = accountId ? [accountId] : accounts.map((a) => a.id);
    return this.messageService.listThreads(accountIds);
  }

  @Get('threads/:id/messages')
  async readThread(@Param('id') id: string) {
    return this.messageService.readThread(id);
  }
}
