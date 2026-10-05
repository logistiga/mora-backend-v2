import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { GoogleCallbackQueryDto } from './dto/google-callback.dto.js';
import { GoogleGmailAccountService } from './google-gmail-account.service.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleDocsService } from './google-docs.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@ApiTags('google')
@Controller('google')
export class GoogleController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly gmailAccounts: GoogleGmailAccountService,
    private readonly contactsSync: GoogleContactsSyncService,
    private readonly docs: GoogleDocsService,
  ) {}

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.getStatus(user.id);
  }

  @Post('oauth/authorize')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return { url: this.oauth.createAuthUrl(user.id) };
  }

  /** Public by design: Google redirects the browser here. The signed, expiring `state` is the authority. */
  @Get('oauth/callback')
  callback(@Query() query: GoogleCallbackQueryDto) {
    return this.oauth.handleCallback(query.code, query.state);
  }

  @Post('gmail/account')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  connectGmail(@CurrentUser() user: AuthenticatedUser) {
    return this.gmailAccounts.connectMailbox(user.id);
  }

  @Delete('account')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.disconnect(user.id);
  }

  @Post('contacts/sync')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  syncContacts(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsSync.sync(user.id);
  }

  @Get('docs')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  listDocs(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.docs.listDocuments(user.id, limit ? Number(limit) : undefined);
  }

  @Get('docs/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  readDoc(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.docs.readDocument(user.id, id);
  }
}
