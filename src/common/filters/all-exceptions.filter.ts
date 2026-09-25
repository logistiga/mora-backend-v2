import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  error?: string;
  requestId?: string;
}

/**
 * Catches everything that escapes controllers/services and turns it into a
 * consistent JSON error shape, so clients never see a raw stack trace or an
 * inconsistent ad-hoc error format.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
      message,
      requestId: (request as Request & { id?: string }).id,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} [${body.requestId ?? '-'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} [${body.requestId ?? '-'}]`,
      );
    }

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
