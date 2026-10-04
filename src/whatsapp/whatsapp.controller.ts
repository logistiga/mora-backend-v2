import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CreateWhatsAppAccountDto } from './dto/create-whatsapp-account.dto.js';
import { ListWhatsAppMessagesQueryDto } from './dto/list-whatsapp-messages.dto.js';
import { SendWhatsAppMessageDto } from './dto/send-whatsapp-message.dto.js';
import { ListWhatsAppConversationsQueryDto } from './dto/list-whatsapp-conversations.dto.js';
import type { WhatsAppProviderInterface } from './providers/whatsapp-provider.interface.js';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.token.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';

@ApiTags('whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly accountService: WhatsAppAccountService,
    private readonly messageService: WhatsAppMessageService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProviderInterface,
  ) {}

  @Get('accounts')
  async listAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.accountService.list(user.id);
  }

  @Post('accounts')
  async createAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWhatsAppAccountDto) {
    return this.accountService.create(user.id, dto);
  }

  @Delete('accounts/:id')
  async deleteAccount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.accountService.remove(user.id, id);
  }

  @Get('accounts/:id/health')
  async health(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.accountService.getOwnedRow(user.id, id);
    const connection = await this.accountService.resolveConnection(id);
    const result = await this.provider.checkHealth(connection);
    await this.accountService.updateHealth(id, result.connected ? 'connected' : 'error', result.error);
    return result;
  }

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWhatsAppConversationsQueryDto) {
    const accounts = await this.accountService.list(user.id);
    const accountIds = query.accountId ? [query.accountId] : accounts.map((a) => a.id);
    return this.messageService.listConversations(accountIds);
  }

  @Get('conversations/:id/messages')
  async readMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.messageService.assertOwnedConversation(user.id, id);
    return this.messageService.readMessages(id);
  }

  @Post('messages')
  async sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendWhatsAppMessageDto) {
    return this.messageService.sendTextForUser(user.id, dto.conversationId, dto.text);
  }

  @Get('messages')
  async listMessages(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWhatsAppMessagesQueryDto) {
    return this.messageService.listMessagesForUser(user.id, query);
  }

  @Get('messages/:id')
  async getMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.messageService.getMessageForUser(user.id, id);
  }
}
