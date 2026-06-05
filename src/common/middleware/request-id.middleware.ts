import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response, NextFunction } from 'express';

/**
 * Stamps every incoming request with an `x-request-id` header (honouring the
 * client's value if provided, generating one otherwise) and threads it into:
 *   - the outgoing response header (so the client can grep for it)
 *   - `request.requestId` (for downstream NestJS handlers + filters)
 *   - the Sentry scope (so a captured exception's tags include it)
 *
 * Correlation: a user reporting "this failed" in beta can copy the
 * `x-request-id` from their network tab → we grep the api logs AND find the
 * matching Sentry event by tag. Without this, you're staring at timestamps
 * trying to guess which row in the log is theirs.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming =
      typeof req.headers['x-request-id'] === 'string'
        ? (req.headers['x-request-id'] as string).slice(0, 64)
        : null;
    const id = incoming && /^[A-Za-z0-9_-]+$/.test(incoming) ? incoming : randomUUID();

    (req as Request & { requestId?: string }).requestId = id;
    res.setHeader('x-request-id', id);

    // Sentry's current-hub scope is per-async-context — using withScope here
    // would close the scope before downstream handlers run. Instead, set a
    // tag on the active hub for this request; the GlobalExceptionFilter
    // captures it on exception.
    Sentry.getCurrentScope().setTag('request_id', id);

    next();
  }
}
