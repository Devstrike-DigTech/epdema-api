import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDraftDto } from './dto/create-event-draft.dto';
import { UpdateEventDraftDto } from './dto/update-event-draft.dto';
import { PublishEventDto, UnpublishEventDto } from './dto/publish-event.dto';
import { RenameShareSlugDto } from './dto/rename-share-slug.dto';
import { serializeEvent } from './events.serializer';
import { EventResponseDto, PublishReadinessResponseDto } from './events.responses';

/**
 * Path-param shorthand: every parameterized route below uses `:id`; the
 * `@ApiParam` decorator with `format: 'uuid'` makes Swagger render a UUID
 * picker in the docs UI and stops codegen from typing it as plain string.
 */
const ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Event UUID.',
} as const;

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ operationId: 'events_list', summary: 'List the caller\'s events' })
  @ApiOkResponse({
    type: [EventResponseDto],
    description: 'Events created by the authenticated user or where they are a planning member.',
  })
  async list(@CurrentUser() user: CurrentUserPayload) {
    const events = await this.events.listForUser(user.id);
    return events.map(serializeEvent);
  }

  @Post()
  @ApiOperation({ operationId: 'events_createDraft', summary: 'Create a draft event' })
  @ApiOkResponse({
    type: EventResponseDto,
    description: 'Create a draft event. No payment yet — tier is chosen later.',
  })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateEventDraftDto) {
    const event = await this.events.createDraft(user.id, dto);
    return serializeEvent(event);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'events_get', summary: 'Get one event' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description: 'Get an event the authenticated user is a planning member of (or owns).',
  })
  async get(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const event = await this.events.getAccessibleOrThrow(user.id, id);
    return serializeEvent(event);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'events_updateDraft', summary: 'Update a draft event' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description: 'Update a draft event (title, type, date, description).',
  })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDraftDto,
  ) {
    const event = await this.events.updateDraft(user.id, id, dto);
    return serializeEvent(event);
  }

  @Get(':id/publish-readiness')
  @ApiOperation({
    operationId: 'events_publishReadiness',
    summary: 'Compute publish-readiness',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: PublishReadinessResponseDto,
    description:
      'Which blockers remain (unlocked segments, missing date, odd voting count). Used by the pre-publish modal.',
  })
  async publishReadiness(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.checkPublishReadiness(user.id, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({ operationId: 'events_publish', summary: 'Publish the event (admin)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description:
      'Publish the event (admin only). Validates all blockers; generates a share slug; broadcasts event.changed.',
  })
  async publish(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: PublishEventDto,
  ) {
    void _dto;
    const event = await this.events.publish(user.id, id);
    return serializeEvent(event);
  }

  @Post(':id/mark-past')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'events_markPast',
    summary: 'Flip a published event to past state (admin)',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description:
      'Phase 7·A — admin-only manual transition from published → past. Required ' +
      'before planning members can submit reviews. Idempotent on already-past events. ' +
      '400 when state is not published, or when scheduledDate is null/future. ' +
      'In 7·D, a worker will fire this automatically once the scheduled date passes.',
  })
  async markPast(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const event = await this.events.markPast(user.id, id);
    return serializeEvent(event);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({ operationId: 'events_unpublish', summary: 'Roll back to planning (admin)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description:
      'Roll back to planning state (admin only). Preserves the share slug so re-publishing keeps the same URL.',
  })
  async unpublish(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnpublishEventDto,
  ) {
    const event = await this.events.unpublish(user.id, id, dto.reason);
    return serializeEvent(event);
  }

  @Patch(':id/share-slug')
  @ApiOperation({
    operationId: 'events_renameShareSlug',
    summary: 'Rename the public share slug (admin)',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: EventResponseDto,
    description:
      'Rename the public share slug (admin only, Occasion-tier feature). ' +
      'Format: lowercase letters/digits/single hyphens, 3-64 chars. Reserved ' +
      'words and taken slugs return 409.',
  })
  async renameShareSlug(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameShareSlugDto,
  ) {
    const event = await this.events.renameShareSlug(user.id, id, dto.slug);
    return serializeEvent(event);
  }
}
