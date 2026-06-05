import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from './public.decorator';

/**
 * Reports which social-auth providers the server has credentials for, so
 * the web client can render only the buttons that actually work.
 *
 * Better Auth itself doesn't expose this — its `signIn.social()` would
 * happily 500 in dev if you wired a Google button without env vars.
 * This endpoint reads the same env vars `better-auth.config.ts` reads.
 *
 * Public because the answer is the same for every visitor + needs to be
 * fetched before sign-in.
 */
/**
 * NOT mounted under `/auth/...` — main.ts has a regex catch-all that routes
 * every `/api/auth/*` request to Better Auth before the NestJS router runs.
 * We use `/auth-providers` so this controller stays reachable.
 */
@ApiTags('auth')
@Controller('auth-providers')
export class AuthProvidersController {
  @Public()
  @Get()
  @ApiOperation({
    operationId: 'auth_providers',
    summary: 'List enabled social-auth providers',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        google: { type: 'boolean', example: true },
        apple: { type: 'boolean', example: false },
      },
    },
  })
  list(): { google: boolean; apple: boolean } {
    return {
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      apple: Boolean(
        process.env.APPLE_CLIENT_ID &&
          process.env.APPLE_TEAM_ID &&
          process.env.APPLE_KEY_ID &&
          process.env.APPLE_PRIVATE_KEY,
      ),
    };
  }
}
