import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from './better-auth.config';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Default-deny auth guard. Apply globally (or selectively via @UseGuards) and
 * mark explicitly-public endpoints with @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    // Attach for downstream consumers (@CurrentUser decorator)
    (req as Request & { user?: unknown; session?: unknown }).user = session.user;
    (req as Request & { user?: unknown; session?: unknown }).session = session.session;

    return true;
  }
}
