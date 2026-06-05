import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/public.decorator';
import { InviteesService } from './invitees.service';
import { SubmitRsvpDto } from './dto';
import { serializePublicRsvpView } from './serializers';
import { PublicRsvpResponseDto } from './invitees.responses';
import { BrandService } from '../brand/brand.service';

/**
 * The rsvp token is the unguessable string baked into the URL by
 * {@link InviteesService.add} — base64url of 24 random bytes (~32 chars). It is
 * NOT a UUID, so we deliberately omit `format: 'uuid'` from the @ApiParam.
 */
const TOKEN_PARAM = {
  name: 'token',
  description:
    'RSVP token from the invitation URL — base64url of 24 random bytes (~32 chars).',
  example: 'aBcD1234EFgh5678IJklMNop9012QrSt',
} as const;

/**
 * Token-gated public endpoints for the "I got an invite email" flow.
 *
 * Auth is by possession of the unguessable `rsvpToken` baked into the URL
 * (24 random bytes, base64url'd → ~32 chars). No login required — that's the
 * whole point of an event invite: the recipient may not have an account.
 */
@ApiTags('rsvp')
@Controller('rsvp')
export class RsvpController {
  constructor(
    private readonly invitees: InviteesService,
    private readonly brand: BrandService,
  ) {}

  @Public()
  @Get(':token')
  @ApiOperation({ operationId: 'rsvp_lookup', summary: 'Look up an invitation by token' })
  @ApiParam(TOKEN_PARAM)
  @ApiOkResponse({
    type: PublicRsvpResponseDto,
    description:
      'Look up an invitation by RSVP token. Returns event essentials, the ' +
      "invitee's own status, and (Production+ tier) the event brand so the " +
      'RSVP page can render in the organizer\'s theme.',
  })
  async lookup(@Param('token') token: string) {
    const { invitee, event } = await this.invitees.lookupByToken(token);
    const brand = this.brand.publicBrand(
      (event as { features?: unknown }).features,
      (event as { brand?: unknown }).brand,
    );
    return serializePublicRsvpView(invitee, event, brand);
  }

  @Public()
  // Phase 5.7·F — guards against token guessing + flapping yes/no/maybe
  // bots. Tokens are 32 chars base64url (~190 bits) so guessing is
  // mathematically off the table, but a tight cap closes off any chance
  // of an attacker spamming submit() to mess with reminder scheduling.
  @Throttle({ short: { ttl: 10_000, limit: 5 }, long: { ttl: 10 * 60_000, limit: 30 } })
  @Post(':token')
  @HttpCode(200)
  @ApiOperation({ operationId: 'rsvp_submit', summary: 'Submit or update an RSVP' })
  @ApiParam(TOKEN_PARAM)
  @ApiOkResponse({
    type: PublicRsvpResponseDto,
    description:
      'Submit / update an RSVP (yes / no / maybe). Idempotent — the same ' +
      'invitee can change their mind any time before the event.',
  })
  async submit(@Param('token') token: string, @Body() dto: SubmitRsvpDto) {
    const { invitee, event } = await this.invitees.submitRsvp(token, {
      status: dto.status,
      name: dto.name,
      customAnswers: dto.customAnswers,
    });
    const brand = this.brand.publicBrand(
      (event as { features?: unknown }).features,
      (event as { brand?: unknown }).brand,
    );
    return serializePublicRsvpView(invitee, event, brand);
  }
}
