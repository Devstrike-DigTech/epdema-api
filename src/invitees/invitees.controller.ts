import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { InviteesService } from './invitees.service';
import { AddInviteeDto, BulkAddInviteesDto } from './dto';
import { SetRsvpQuestionsDto } from './questions-dto';
import { serializeInviteeAdmin } from './serializers';
import {
  AddInviteesResponseDto,
  CancelRemindersResponseDto,
  InviteeAdminDto,
  InviteeStatusCountsDto,
  RemindersListResponseDto,
  RsvpQuestionsResponseDto,
  SendInvitationsResponseDto,
} from './invitees.responses';
import { RemindersService } from '../reminders/reminders.service';
import { MembersService } from '../members/members.service';

/**
 * Path-param shorthand: every parameterized route below uses `:eventId` and
 * sometimes `:inviteeId`; both are UUIDs. Declaring them at the method level
 * via `@ApiParam({ format: 'uuid' })` makes Swagger render UUID pickers in
 * the docs UI and stops codegen from typing them as plain strings.
 */
const EVENT_ID_PARAM = {
  name: 'eventId',
  format: 'uuid',
  description: 'Event UUID.',
} as const;

const INVITEE_ID_PARAM = {
  name: 'inviteeId',
  format: 'uuid',
  description: 'Invitee UUID.',
} as const;

/**
 * Admin endpoints for managing the people who will *attend* the event
 * (distinct from `members` — the people who help plan it). Token-gated
 * RSVP endpoints live in {@link RsvpController}.
 */
@ApiTags('invitees')
@ApiBearerAuth()
@Controller('events/:eventId/invitees')
export class InviteesController {
  constructor(
    private readonly invitees: InviteesService,
    private readonly reminders: RemindersService,
    private readonly members: MembersService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'invitees_list', summary: 'List invitees for an event' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: [InviteeAdminDto],
    description: 'List all invitees for the event (admin only).',
  })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const list = await this.invitees.list(user.id, eventId);
    return list.map(serializeInviteeAdmin);
  }

  @Get('counts')
  @ApiOperation({ operationId: 'invitees_counts', summary: 'RSVP status breakdown' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: InviteeStatusCountsDto,
    description: 'RSVP status breakdown — { pending, yes, no, maybe, total }.',
  })
  async counts(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.invitees.statusCounts(user.id, eventId);
  }

  @Post()
  @ApiOperation({ operationId: 'invitees_addOne', summary: 'Add a single invitee' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: AddInviteesResponseDto,
    description:
      'Add a single invitee by email. Returns a one-item result array so the ' +
      'admin sees the same shape as the bulk endpoint.',
  })
  async addOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: AddInviteeDto,
  ) {
    const results = await this.invitees.add(user.id, eventId, [
      { email: dto.email, name: dto.name },
    ]);
    return { results };
  }

  @Post('bulk')
  @ApiOperation({ operationId: 'invitees_addBulk', summary: 'Bulk-add invitees' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: AddInviteesResponseDto,
    description:
      'Add up to 500 invitees in one go. Returns a per-row result list ' +
      "('created' | 'updated' | 'skipped_existing' | 'invalid') so the admin " +
      'can see exactly what happened to each entry.',
  })
  async addBulk(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: BulkAddInviteesDto,
  ) {
    const results = await this.invitees.add(
      user.id,
      eventId,
      dto.invitees.map((i) => ({ email: i.email, name: i.name })),
    );
    return { results };
  }

  @Post('send-invitations')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'invitees_sendInvitations',
    summary: 'Send invitation emails',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: SendInvitationsResponseDto,
    description:
      'Send the "you\'re invited" email to invitees. By default only those ' +
      'who have not yet been emailed; pass ?all=true to re-send to everyone.',
  })
  async sendInvitations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('all') all?: string,
  ) {
    const onlyUninvited = all !== 'true';
    return this.invitees.sendInvitations(user.id, eventId, { onlyUninvited });
  }

  @Delete(':inviteeId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'invitees_remove', summary: 'Remove an invitee' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(INVITEE_ID_PARAM)
  @ApiOkResponse({ description: 'Remove an invitee (admin only).' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('inviteeId', ParseUUIDPipe) inviteeId: string,
  ): Promise<void> {
    await this.invitees.remove(user.id, eventId, inviteeId);
  }

  @Get('questions')
  @ApiOperation({
    operationId: 'invitees_getQuestions',
    summary: "Read the event's custom RSVP question set",
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: RsvpQuestionsResponseDto,
    description: "Read the event's custom RSVP question set (admin only).",
  })
  async getQuestions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.invitees.listRsvpQuestions(user.id, eventId);
  }

  @Put('questions')
  @ApiOperation({
    operationId: 'invitees_setQuestions',
    summary: "Replace the event's custom RSVP question set",
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: RsvpQuestionsResponseDto,
    description:
      "Replace the event's custom RSVP question set (admin only, Occasion+ " +
      'gated, tier cap enforced). Pass [] to remove all questions.',
  })
  async setQuestions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SetRsvpQuestionsDto,
  ) {
    return this.invitees.setRsvpQuestions(user.id, eventId, dto.questions);
  }

  // ── Reminders (Phase 5c, Gathering+) ────────────────────────────────

  @Get('reminders')
  @ApiOperation({
    operationId: 'invitees_listReminders',
    summary: 'List scheduled + recent reminders',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: RemindersListResponseDto,
    description:
      'List scheduled + recent reminders for this event (admin only). Used ' +
      "by the admin invitees page to show 'N reminders scheduled' with status.",
  })
  async listReminders(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<RemindersListResponseDto> {
    await this.members.assertAdminOrThrow(user.id, eventId);
    const rows = await this.reminders.listForEvent(eventId);
    return { reminders: rows.map(serializeReminder) };
  }

  @Post('reminders/cancel-all')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'invitees_cancelAllReminders',
    summary: 'Cancel all scheduled reminders',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: CancelRemindersResponseDto,
    description:
      'Cancel every still-scheduled reminder for this event (admin only). ' +
      'History rows stay visible with status="cancelled".',
  })
  async cancelAllReminders(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    await this.members.assertAdminOrThrow(user.id, eventId);
    return this.reminders.cancelAllForEvent(eventId);
  }
}

type ReminderKind = 'rsvp_nudge' | 'event_tomorrow';
type ReminderStatus = 'scheduled' | 'sent' | 'cancelled' | 'failed' | 'skipped';

function serializeReminder(r: {
  id: string;
  eventId: string;
  inviteeId: string | null;
  kind: string;
  runAt: Date;
  status: string;
  sentAt: Date | null;
  error: string | null;
}) {
  // Prisma columns are plain String; the underlying enum lives in the
  // BullMQ + service layer. Narrow once here so the response DTO matches.
  return {
    id: r.id,
    eventId: r.eventId,
    inviteeId: r.inviteeId,
    kind: r.kind as ReminderKind,
    runAt: r.runAt.toISOString(),
    status: r.status as ReminderStatus,
    sentAt: r.sentAt?.toISOString() ?? null,
    error: r.error,
  };
}
