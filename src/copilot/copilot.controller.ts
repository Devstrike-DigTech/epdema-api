import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { CopilotService } from './copilot.service';
import { DraftEventDto } from './dto';
import { CopilotDraftResponseDto } from './copilot.responses';

// Opus is expensive, so production keeps a hard cost-guard: 1 draft per 30s
// (anti button-mash) and 5 per hour (long-tail ceiling). In dev we iterate on
// the wizard far more than 5×/hour, so the guard just gets in the way — relax
// it everywhere except production. The per-actor 24h AiBudgetGuard still applies
// in both environments, so dev can't run up an unbounded bill.
const DRAFT_EVENT_THROTTLE =
  process.env.NODE_ENV === 'production'
    ? {
        short: { ttl: 30_000, limit: 1 },
        long: { ttl: 60 * 60 * 1000, limit: 5 },
      }
    : {
        short: { ttl: 1_000, limit: 1_000 },
        long: { ttl: 60 * 60 * 1000, limit: 10_000 },
      };

@ApiTags('copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('draft-event')
  // Phase 6·C — tighter throttle than the per-segment endpoint because each
  // call uses Opus (~5x Sonnet cost). Production: 1/30s blocks button-mashing;
  // 5/hour is the long-tail ceiling. Dev relaxes both (see DRAFT_EVENT_THROTTLE).
  // Layered on top of the per-actor 24h budget cap in AiBudgetGuard ($0.30/day).
  @Throttle(DRAFT_EVENT_THROTTLE)
  @ApiOperation({
    operationId: 'copilot_draftEvent',
    summary: 'Draft an event scaffold from a free-form description (Production+ Opus)',
  })
  @ApiOkResponse({
    type: CopilotDraftResponseDto,
    description:
      'AI-generated event scaffold: { title, eventType, scheduledDate?, ' +
      'description?, segments: [{ segmentType, title, description }], costCents }. ' +
      'The web wizard pre-fills its form from this; the user can edit anything ' +
      'before final create.',
  })
  async draftEvent(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DraftEventDto,
  ) {
    return this.copilot.draft({ actorUserId: user.id, description: dto.description });
  }
}
