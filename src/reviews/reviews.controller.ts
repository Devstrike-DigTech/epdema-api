import {
  Body,
  Controller,
  Get,
  HttpCode,
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

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { SubmitReviewDto } from './dto';
import {
  EventReviewDto,
  EventReviewsListResponseDto,
  ReviewGivenDto,
  ReviewReceivedDto,
} from './reviews.responses';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('events/:eventId/reviews')
  @HttpCode(200)
  // One-shot per (reviewer, event) is enforced at the DB layer via the
  // unique constraint; this throttle just slows a runaway client.
  @Throttle({ short: { ttl: 30_000, limit: 3 } })
  @ApiOperation({
    operationId: 'reviews_submit',
    summary: 'Submit a 1-5 review of the event creator (planning member only)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiOkResponse({
    type: EventReviewDto,
    description:
      'Submit one review per planning member per event. Event must be in ' +
      'state `past`. Reviewer cannot review their own event. 409 on a ' +
      'second submission for the same (reviewer, event). Atomic with the ' +
      "rolling average update on the creator's `user_profile.ratingAvg`.",
  })
  async submit(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SubmitReviewDto,
  ) {
    return this.reviews.submit({
      eventId,
      reviewerId: user.id,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  @Get('events/:eventId/reviews')
  @ApiOperation({
    operationId: 'reviews_listForEvent',
    summary: 'List reviews on this event (admin/creator see all; member sees own)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiOkResponse({
    type: EventReviewsListResponseDto,
    description:
      'Admin or creator gets every review with reviewer + comment hydrated. ' +
      'A non-privileged planning member sees only their own row. Non-members ' +
      'get 403 from the assertMember guard.',
  })
  async listForEvent(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.reviews.listForEvent(eventId, user.id);
  }

  @Get('users/me/reviews-given')
  @ApiOperation({
    operationId: 'reviews_listGivenByMe',
    summary: 'List reviews I have submitted',
  })
  @ApiOkResponse({ type: [ReviewGivenDto] })
  async listGivenByMe(@CurrentUser() user: CurrentUserPayload) {
    return this.reviews.listGivenByUser(user.id);
  }

  @Get('users/me/reviews-received')
  @ApiOperation({
    operationId: 'reviews_listReceivedByMe',
    summary: 'List reviews of my events (creator surface; comments included for self)',
  })
  @ApiOkResponse({ type: [ReviewReceivedDto] })
  async listReceivedByMe(@CurrentUser() user: CurrentUserPayload) {
    return this.reviews.listReceivedByUser(user.id, user.id);
  }
}
