import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { VibePackService } from './vibe-pack.service';
import { VibePackResponseDto } from './vibe-pack.responses';

@ApiTags('vibe-pack')
@ApiBearerAuth()
@Controller('events/:eventId/vibe-pack')
export class VibePackController {
  constructor(private readonly vibe: VibePackService) {}

  @Post()
  @HttpCode(200)
  // Vibe pack is one-shot enforced inside the service — but throttle anyway
  // so a tight retry loop on the client doesn't burn budget if the one-shot
  // check fails open under some future refactor.
  @Throttle({ short: { ttl: 30_000, limit: 1 } })
  @ApiOperation({
    operationId: 'vibePack_generate',
    summary: 'Generate the vibe pack for an event (admin, add-on required)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiOkResponse({
    type: VibePackResponseDto,
    description:
      'Generates the one-shot vibe pack: theme name, palette, decoration + music ' +
      "ideas, emoji. Auto-applies the palette to event.brand. 403 when the event " +
      "doesn't have the `ai_vibe_pack` add-on; 409 when already generated.",
  })
  async generate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.vibe.generate({ eventId, actorUserId: user.id });
  }
}
