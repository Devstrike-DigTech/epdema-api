import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

/**
 * RFC 7807 problem+json response shape.
 * Stable contract for both web and Flutter clients.
 *
 * Phase 5.7·B added `requestId` so a beta user reporting "this failed" can
 * paste the value back and we can find the matching Sentry event + log line
 * by tag.
 */
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
  requestId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        title = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        title = (b.error as string) ?? exception.message;
        detail = Array.isArray(b.message) ? undefined : (b.message as string);
        if (Array.isArray(b.message)) {
          errors = { _: b.message as string[] };
        }
      }
    } else if (exception instanceof Error) {
      detail = process.env.NODE_ENV === 'production' ? undefined : exception.message;
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('Unknown exception', exception);
    }

    // Phase 5.7·B — send 5xx + non-HttpException errors to Sentry. 4xx
    // (validation, auth, not-found) are user-driven, not bugs — Sentry's
    // beforeSend hook also filters them out as belt-and-braces. Tag the
    // event with the request id so logs + Sentry events correlate.
    if (status >= 500 || !(exception instanceof HttpException)) {
      Sentry.withScope((scope) => {
        if (request.requestId) scope.setTag('request_id', request.requestId);
        scope.setTag('http.status', status.toString());
        scope.setContext('request', {
          url: request.url,
          method: request.method,
          headers: { 'user-agent': request.headers['user-agent'] },
        });
        Sentry.captureException(exception);
      });
    }

    const problem: ProblemDetails = {
      type: `https://epdema.com/errors/${status}`,
      title,
      status,
      detail,
      instance: request.url,
      ...(errors && { errors }),
      ...(request.requestId && { requestId: request.requestId }),
    };

    response.status(status).type('application/problem+json').json(problem);
  }
}
