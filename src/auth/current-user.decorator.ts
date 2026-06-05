import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface CurrentUserPayload {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  image?: string | null;
}

/**
 * Resolves to the authenticated user attached by AuthGuard.
 * Throws nothing — callers should rely on AuthGuard to guarantee presence,
 * or check for undefined on @Public routes.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    return req.user;
  },
);
