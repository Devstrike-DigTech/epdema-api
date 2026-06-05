import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { MembersService } from './members.service';
import { serializePublicInvitation } from './serializers';
import { AcceptInvitationResponseDto, PublicInvitationDto } from './members.responses';

/**
 * Tokens are random 32-byte buffers rendered as hex (see MembersService.invite),
 * so 64 hex chars. Documented as a plain string with an example; no `format`
 * because OpenAPI doesn't have a standard one for our shape.
 */
const TOKEN_PARAM = {
  name: 'token',
  description:
    'Opaque invitation token (64-char hex) emailed to the recipient and returned in acceptUrl.',
  example: '3f9c1e7b8a2d4f5e6c0b9a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f',
} as const;

/**
 * Endpoints scoped by invitation token. Lookup is public (so an
 * unauthenticated recipient can see what they're being invited to); accept
 * requires auth and matching email.
 */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Public()
  @Get(':token')
  @ApiOperation({
    operationId: 'invitations_lookup',
    summary: 'Public peek at a planning invitation (unauthenticated)',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiOkResponse({
    type: PublicInvitationDto,
    description:
      'Public peek at an invitation. Returns event title, inviter, expiry — no sensitive data.',
  })
  async lookup(@Param('token') token: string) {
    const inv = await this.members.lookupByToken(token);
    if (!inv) throw new NotFoundException('Invitation not found');
    return serializePublicInvitation(inv);
  }

  @ApiBearerAuth()
  @Post(':token/accept')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'invitations_accept',
    summary: 'Accept a planning invitation (authenticated)',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiOkResponse({
    type: AcceptInvitationResponseDto,
    description: 'Accept an invitation. Requires signed-in user whose email matches.',
  })
  async accept(
    @CurrentUser() user: CurrentUserPayload,
    @Param('token') token: string,
  ) {
    return this.members.acceptInvitation(user.id, user.email, token);
  }
}
