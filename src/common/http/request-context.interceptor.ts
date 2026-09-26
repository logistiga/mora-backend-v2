import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../auth/entities/token-payload.interface.js';
import { RequestContextService } from './request-context.service.js';

type HttpRequestLike = {
  id?: string;
  method?: string;
  originalUrl?: string;
  url?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: AuthenticatedUser;
  log?: {
    child(bindings: Record<string, unknown>): HttpRequestLike['log'];
  };
};

type HttpResponseLike = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const response = context.switchToHttp().getResponse<HttpResponseLike>();
    const requestId = request.id ?? 'unknown';

    return new Observable((subscriber) => {
      this.requestContext.run(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          userId: request.user?.id,
          role: request.user?.role,
          scope: pickString(request.body?.scope, request.query?.scope),
          space: pickString(request.body?.space, request.query?.space),
          conversationId: pickString(request.body?.conversationId, request.query?.conversationId),
          voiceSessionId: pickString(request.params?.id, request.body?.voiceSessionId),
        },
        () => {
          request.log = request.log?.child({
            requestId,
            userId: request.user?.id,
            scope: pickString(request.body?.scope, request.query?.scope),
            space: pickString(request.body?.space, request.query?.space),
          });
          response.setHeader('X-Request-Id', requestId);
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
