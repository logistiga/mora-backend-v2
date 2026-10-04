import { Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { GoogleCallbackQueryDto } from './dto/google-callback.dto.js';
import { GoogleOAuthService } from './google-oauth.service.js';

@ApiTags('google')
@Controller('google')
export class GoogleController {
  constructor(private readonly oauth: GoogleOAuthService) {}

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

  @Delete('account')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.disconnect(user.id);
  }
}
