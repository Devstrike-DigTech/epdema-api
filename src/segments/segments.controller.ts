import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { SegmentsService } from './segments.service';
import { serializeSegment, serializeSegmentDetail } from './segments.serializer';
import { LockSegmentDto, UnlockSegmentDto } from './dto/lock-segment.dto';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { ReorderSegmentsDto } from './dto/reorder-segments.dto';
import { SegmentDetailResponseDto, SegmentResponseDto } from './segments.responses';

/**
 * Path-param shorthand: this controller has two distinct UUIDs in the URL —
 * the parent event (`:eventId`) and the segment (`:segmentId`). Declaring them
 * as const objects keeps the @ApiParam blocks short at each route.
 */
const EVENT_ID_PARAM = {
  name: 'eventId',
  format: 'uuid',
  description: 'Parent event UUID.',
} as const;

const SEGMENT_ID_PARAM = {
  name: 'segmentId',
  format: 'uuid',
  description: 'Segment UUID.',
} as const;

@ApiTags('segments')
@ApiBearerAuth()
@Controller('events/:eventId/segments')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @ApiOperation({ operationId: 'segments_list', summary: 'List segments for an event' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: [SegmentResponseDto],
    description: 'List segments for an event (ordered by position).',
  })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const segments = await this.segments.listForEvent(user.id, eventId);
    return segments.map(serializeSegment);
  }

  @Get(':segmentId')
  @ApiOperation({ operationId: 'segments_detail', summary: 'Get segment detail with proposals' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    type: SegmentDetailResponseDto,
    description:
      'Segment detail with live proposals + objections embedded. One call for the segment-detail page.',
  })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
  ) {
    const segment = await this.segments.getDetail(user.id, eventId, segmentId);
    return serializeSegmentDetail(segment);
  }

  @Post(':segmentId/lock')
  @HttpCode(200)
  @ApiOperation({ operationId: 'segments_lock', summary: 'Lock a segment with a winning proposal' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    type: SegmentDetailResponseDto,
    description:
      'Lock the segment with the chosen proposal as the winner. Atomic state transition under serializable txn + per-segment advisory lock.',
  })
  async lock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: LockSegmentDto,
  ) {
    // assertReadableOrThrow inside the service double-checks event ownership;
    // we just need to make sure the URL eventId matches the URL pattern.
    await this.segments.lockSegment(user.id, segmentId, dto.proposalId);
    const detail = await this.segments.getDetail(user.id, eventId, segmentId);
    return serializeSegmentDetail(detail);
  }

  @Post(':segmentId/unlock')
  @HttpCode(200)
  @ApiOperation({ operationId: 'segments_unlock', summary: 'Unlock a locked segment' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    type: SegmentDetailResponseDto,
    description:
      'Unlock a locked segment. Restores all proposals to live state; clears lockedValue.',
  })
  async unlock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: UnlockSegmentDto,
  ) {
    await this.segments.unlockSegment(user.id, segmentId, dto.reason);
    const detail = await this.segments.getDetail(user.id, eventId, segmentId);
    return serializeSegmentDetail(detail);
  }

  // ────────────────────────────────────────────────────────────
  // Custom-segment CRUD (Phase 4b) — admin only
  // ────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ operationId: 'segments_create', summary: 'Add a custom segment (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiCreatedResponse({
    type: SegmentResponseDto,
    description: 'Add a custom segment (admin only). Respects tier maxSegments cap.',
  })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateSegmentDto,
  ) {
    const created = await this.segments.createSegment(user.id, eventId, dto);
    return serializeSegment(created);
  }

  @Patch(':segmentId')
  @ApiOperation({ operationId: 'segments_update', summary: 'Rename or edit a segment (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    type: SegmentResponseDto,
    description: 'Rename or edit a segment (admin only). Works on locked segments too.',
  })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    const updated = await this.segments.updateSegment(user.id, eventId, segmentId, dto);
    return serializeSegment(updated);
  }

  @Delete(':segmentId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'segments_delete', summary: 'Delete a segment (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    description:
      'Delete a segment (admin only). Refused if the segment is locked or has live proposals. Returns 204 No Content on success.',
  })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
  ): Promise<void> {
    await this.segments.deleteSegment(user.id, eventId, segmentId);
  }

  @Post('reorder')
  @HttpCode(200)
  @ApiOperation({ operationId: 'segments_reorder', summary: 'Reorder all segments (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: [SegmentResponseDto],
    description:
      'Reorder all segments in one atomic transaction (admin only). Must list every segment ID exactly once.',
  })
  async reorder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ReorderSegmentsDto,
  ) {
    await this.segments.reorderSegments(user.id, eventId, dto.orderedIds);
    const segments = await this.segments.listForEvent(user.id, eventId);
    return segments.map(serializeSegment);
  }
}
