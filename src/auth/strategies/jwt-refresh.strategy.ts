import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration.js';
import type { JwtRefreshPayload } from '../entities/token-payload.interface.js';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService) {
    const jwtConfig = configService.get<AppConfig['jwt']>('app.jwt')!;
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.refreshSecret,
      passReqToCallback: false,
    });
  }

  validate(payload: JwtRefreshPayload): JwtRefreshPayload {
    // Raw payload is passed through; AuthService verifies the jti against the
    // hashed token stored in the database (revocation / rotation check).
    return payload;
  }
}
