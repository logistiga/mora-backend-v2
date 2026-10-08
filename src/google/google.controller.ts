import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { GoogleCallbackQueryDto } from './dto/google-callback.dto.js';
import { GoogleGmailAccountService } from './google-gmail-account.service.js';
import { GoogleContactsSyncService } from './google-contacts-sync.service.js';
import { GoogleContactsPushService } from './google-contacts-push.service.js';
import { GoogleDocsService } from './google-docs.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@ApiTags('google')
@Controller('google')
export class GoogleController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly gmailAccounts: GoogleGmailAccountService,
    private readonly contactsSync: GoogleContactsSyncService,
    private readonly contactsPush: GoogleContactsPushService,
    private readonly docs: GoogleDocsService,
  ) {}

  @Get('status')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.getStatus(user.id);
  }

  @Post('oauth/authorize')
  @ApiSecurity('api-key')
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
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  connectGmail(@CurrentUser() user: AuthenticatedUser) {
    return this.gmailAccounts.connectMailbox(user.id);
  }

  @Delete('account')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.disconnect(user.id);
  }

  @Post('contacts/sync')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  async syncContacts(@CurrentUser() user: AuthenticatedUser) {
    const imported = await this.contactsSync.sync(user.id);
    const pushed = await this.contactsPush.push(user.id);
    return { ...imported, pushed: pushed.pushed, pushFailed: pushed.failed };
  }

  @Get('docs')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  listDocs(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.docs.listDocuments(user.id, limit ? Number(limit) : undefined);
  }

  @Get('docs/:id')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  readDoc(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.docs.readDocument(user.id, id);
  }
}
