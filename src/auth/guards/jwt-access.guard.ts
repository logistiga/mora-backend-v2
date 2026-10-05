import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Accepts a valid JWT access token, or a request already authenticated by a
 * Mora API key (see ApiKeyMiddleware). The key path never bypasses the check:
 * the middleware refuses any invalid key before this guard runs.
 */
@Injectable()
export class JwtAccessGuard extends AuthGuard('jwt-access') {
  override canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ apiKeyAuthenticated?: boolean }>();
    if (request.apiKeyAuthenticated) return true;
    return super.canActivate(context);
  }
}
