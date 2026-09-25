import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../auth/entities/token-payload.interface.js';

interface ErrorResponseBody {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  requestId: string;
  message: string | string[];
  error?: string;
}

type RequestWithContext = Request & {
  id?: string;
  user?: AuthenticatedUser;
  log?: {
    warn(payload: object, message?: string): void;
    error(payload: object, message?: string): void;
  };
};

/**
 * Catches everything that escapes controllers/services and turns it into a
 * consistent JSON error shape, so clients never see a raw stack trace or an
 * inconsistent ad-hoc error format.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;
    const message = this.extractMessage(exceptionResponse, exception);

    const body: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      requestId: request.id ?? 'unknown',
      message,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      request.log?.error(
        {
          requestId: request.id,
          method: request.method,
          path: request.url,
          statusCode: status,
          userId: request.user?.id,
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : { message: String(exception) },
        },
        'Unhandled request failure',
      );
    } else {
      request.log?.warn(
        {
          requestId: request.id,
          method: request.method,
          path: request.url,
          statusCode: status,
          userId: request.user?.id,
        },
        'Handled request exception',
      );
    }

    response.setHeader('X-Request-Id', body.requestId);
    response.status(status).json(body);
  }

  private extractMessage(
    exceptionResponse: string | object | null,
    exception: unknown,
  ): string | string[] {
    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const maybeMessage = (exceptionResponse as { message?: string | string[] }).message;
      if (maybeMessage) return maybeMessage;
    }
    if (typeof exceptionResponse === 'string') return exceptionResponse;
    if (exception instanceof Error) return exception.message;
    return 'Internal server error';
  }
}
