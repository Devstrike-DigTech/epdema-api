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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { MembersService } from './members.service';
import { InviteMemberDto, UpdateMemberRoleDto } from './dto';
import { serializeInvitation, serializeMember } from './serializers';
import {
  InviteMemberResponseDto,
  PlanningInvitationDto,
  PlanningMemberDto,
} from './members.responses';

/**
 * Path-param shorthands. Every route below is nested under `/events/:eventId/...`
 * and most also take a `:memberId` or `:invitationId`. The `@ApiParam` decorators
 * with `format: 'uuid'` make Swagger render UUID pickers in the docs UI and stop
 * codegen from typing them as plain string.
 */
const EVENT_ID_PARAM = {
  name: 'eventId',
  format: 'uuid',
  description: 'Event UUID.',
} as const;

const MEMBER_ID_PARAM = {
  name: 'memberId',
  format: 'uuid',
  description: 'Planning-member row UUID.',
} as const;

const INVITATION_ID_PARAM = {
  name: 'invitationId',
  format: 'uuid',
  description: 'Planning-invitation row UUID.',
} as const;

@ApiTags('members')
@ApiBearerAuth()
@Controller('events/:eventId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({
    operationId: 'members_list',
    summary: "List planning members of an event",
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: [PlanningMemberDto],
    description: 'List planning members of the event.',
  })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const list = await this.members.listForEvent(user.id, eventId);
    return list.map(serializeMember);
  }

  @Get('invitations')
  @ApiOperation({
    operationId: 'members_listInvitations',
    summary: 'List pending planning invitations (admin)',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: [PlanningInvitationDto],
    description: 'List pending invitations for the event (admin only).',
  })
  async listInvitations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const list = await this.members.listInvitations(user.id, eventId);
    return list.map(serializeInvitation);
  }

  @Post('invitations')
  @ApiOperation({
    operationId: 'members_invite',
    summary: 'Invite an email to the planning team (admin)',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: InviteMemberResponseDto,
    description:
      'Invite an email to the event (admin only). Response includes acceptUrl ' +
      'so admins can share manually when email delivery is unreliable.',
  })
  async invite(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: InviteMemberDto,
  ) {
    const { invitation, acceptUrl, emailSent, emailError } = await this.members.invite(
      user.id,
      eventId,
      dto.email,
      dto.role,
    );
    return {
      ...serializeInvitation(invitation),
      // Always returned so admins can copy + share via WhatsApp / Slack / etc.
      // Same token is in the email; same admin power; no extra exposure.
      acceptUrl,
      emailSent,
      ...(emailError && { emailError }),
    };
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'members_revokeInvitation',
    summary: 'Revoke a pending planning invitation (admin)',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(INVITATION_ID_PARAM)
  @ApiOkResponse({ description: 'Revoke a pending invitation (admin only). No body.' })
  async revokeInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    await this.members.revokeInvitation(user.id, eventId, invitationId);
  }

  @Patch(':memberId/role')
  @ApiOperation({
    operationId: 'members_updateRole',
    summary: "Change a planning member's role (admin)",
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({
    type: PlanningMemberDto,
    description: "Change a member's role (admin only).",
  })
  async updateRole(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const updated = await this.members.updateRole(user.id, eventId, memberId, dto.role);
    return serializeMember(updated);
  }

  @Delete(':memberId')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'members_remove',
    summary: 'Remove a planning member (admin)',
  })
  @ApiParam(EVENT_ID_PARAM)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({ description: 'Remove a member from the event (admin only). No body.' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<void> {
    await this.members.remove(user.id, eventId, memberId);
  }
}
