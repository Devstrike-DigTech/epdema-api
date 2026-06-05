import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, type CurrentUserPayload } from '../../auth/current-user.decorator';
import { SegmentSuggestionService } from './segment-suggestion.service';
import { SuggestProposalsDto } from './dto';
import { SegmentSuggestionsResponseDto } from './suggestions.responses';

@ApiTags('segments')
@ApiBearerAuth()
@Controller('events/:eventId/segments/:segmentId/suggestions')
export class SegmentSuggestionsController {
  constructor(private readonly suggestions: SegmentSuggestionService) {}

  @Post()
  // Phase 6·B — protect the AI surface from rapid-fire button-mashing on
  // top of the per-event $0.50 budget cap. 3 calls per 30s is enough for a
  // user who wants to re-roll with a different steer + tight enough to
  // catch an accidental useEffect loop.
  @Throttle({ short: { ttl: 30_000, limit: 3 } })
  @ApiOperation({
    operationId: 'segments_suggestProposals',
    summary: 'Suggest 3-5 proposal candidates for a segment (admin, Occasion+)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'segmentId', format: 'uuid' })
  @ApiOkResponse({
    type: SegmentSuggestionsResponseDto,
    description:
      'Returns 3-5 AI-generated proposal candidates. Each carries a `reason` ' +
      'explaining why it fits THIS event. Admin clicks one to instantiate as ' +
      'a real Proposal via the existing POST /proposals endpoint. Tier-gated ' +
      'on `features.ai.perSegmentSuggestions` (Occasion+); 403 below that.',
  })
  async suggest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: SuggestProposalsDto,
  ) {
    return this.suggestions.suggest({
      eventId,
      segmentId,
      actorUserId: user.id,
      steer: dto.steer,
    });
  }
}
