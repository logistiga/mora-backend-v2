import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module.js';
import { ApiKeyService } from './api-keys/api-key.service.js';
import { ApiKeyMiddleware } from './api-keys/api-key.middleware.js';
import { ApiKeysController } from './api-keys/api-keys.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy.js';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy.js';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    // Actual secret/expiresIn are passed per-call in AuthService (access vs
    // refresh use different secrets), so no default config is needed here.
    JwtModule.register({}),
  ],
  controllers: [AuthController, ApiKeysController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy, ApiKeyService, ApiKeyMiddleware],
  exports: [AuthService, ApiKeyService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiKeyMiddleware).forRoutes('*');
  }
}
