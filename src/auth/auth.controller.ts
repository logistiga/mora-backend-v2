import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import type { JwtRefreshPayload, TokenPair } from './entities/token-payload.interface.js';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOkResponse({ description: 'Access + refresh token pair' })
  async register(@Body() dto: RegisterDto): Promise<TokenPair> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Login is the classic brute-force target: keep it stricter than the global default.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Access + refresh token pair' })
  async login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  @ApiOkResponse({ description: 'Rotated access + refresh token pair' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<TokenPair> {
    const payload = req.user as JwtRefreshPayload;
    return this.authService.refresh(payload, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtRefreshGuard)
  async logout(@Req() req: Request): Promise<void> {
    const payload = req.user as JwtRefreshPayload;
    await this.authService.logout(payload.jti);
  }
}
