import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../database/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  TokenPair,
} from './entities/token-payload.interface.js';
import type { User } from '../generated/prisma/client.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly jwtConfig: AppConfig['jwt'];

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtConfig = this.configService.get<AppConfig['jwt']>('app.jwt')!;
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
    });
    return this.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokenPair(user);
  }

  /**
   * Rotates a refresh token: the presented token is verified against its
   * stored hash, revoked, and a brand new access/refresh pair is issued.
   * Rejects reused or revoked tokens outright.
   */
  async refresh(payload: JwtRefreshPayload, rawToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    const matches = await bcrypt.compare(rawToken, stored.tokenHash);
    if (!matches) {
      throw new UnauthorizedException('Refresh token is invalid');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(stored.user);
  }

  async logout(refreshTokenId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id: refreshTokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(user: User): Promise<TokenPair> {
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessExpiresIn as JwtSignOptions['expiresIn'],
    });

    const jti = randomUUID();
    const refreshPayload: JwtRefreshPayload = { sub: user.id, jti, type: 'refresh' };
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.jwtConfig.refreshSecret,
      expiresIn: this.jwtConfig.refreshExpiresIn as JwtSignOptions['expiresIn'],
    });

    const tokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        tokenHash,
        userId: user.id,
        expiresAt: addDuration(new Date(), this.jwtConfig.refreshExpiresIn),
      },
    });

    return { accessToken, refreshToken };
  }
}

/** Parses simple JWT-style durations like "15m", "7d", "3600s" into a future Date. */
function addDuration(from: Date, duration: string): Date {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) {
    // Fallback: treat as seconds if plain number, else default to 7 days.
    const seconds = Number(duration);
    return new Date(from.getTime() + (Number.isFinite(seconds) ? seconds : 604_800) * 1000);
  }
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return new Date(from.getTime() + value * unitMs[match[2]]);
}
