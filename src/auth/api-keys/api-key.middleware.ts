import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiKeyService, API_KEY_PREFIX } from './api-key.service.js';

/**
 * Authenticates a request carrying a Mora API key (X-Api-Key header, or a
 * `Bearer mora_…` token). A valid key sets req.user and flags the request so
 * JwtAccessGuard lets it through. A key that is present but invalid is refused
 * outright, never falling back to anonymous access.
 */
@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers['x-api-key'];
    const auth = req.headers.authorization;
    const bearer = typeof auth === 'string' && auth.startsWith(`Bearer ${API_KEY_PREFIX}`) ? auth.slice('Bearer '.length) : null;
    const key = typeof header === 'string' && header.length > 0 ? header : bearer;
    if (!key) return next();

    const user = await this.apiKeys.authenticate(key);
    if (!user) return next(new UnauthorizedException());

    (req as Request & { user?: unknown; apiKeyAuthenticated?: boolean }).user = user;
    (req as Request & { apiKeyAuthenticated?: boolean }).apiKeyAuthenticated = true;
    return next();
  }
}
