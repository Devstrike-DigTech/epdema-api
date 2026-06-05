import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the planning-members + planning-invitations
 * controllers. The runtime serializers (`serializers.ts`) return plain objects
 * whose inferred shape matches these classes — we never instantiate them. Their
 * sole job is to give the OpenAPI spec a typed body schema so codegen produces
 * real types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its serializers. Update both when a serializer changes.
 *
 * NOTE: "invitations" here is the planning-team invitation flow (inviting a user
 * to be an admin/contributor/observer on an event). The event-invitee/RSVP flow
 * is a separate module with its own responses file.
 */

const PLANNING_ROLES = ['admin', 'contributor', 'observer'] as const;
const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'expired'] as const;

// ── Nested user shape returned with every member row ───────────────────

export class PlanningMemberUserDto {
  @ApiProperty({ example: 'usr_2N9k8xQpL3vM5Rb1Tw7yZc' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Adebayo' })
  name!: string | null;

  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'https://lh3.googleusercontent.com/a/ACg8ocJ...',
  })
  image!: string | null;
}

// ── Planning member ────────────────────────────────────────────────────

export class PlanningMemberDto {
  @ApiProperty({ format: 'uuid', example: 'a3f1d9c8-4b2e-4f6a-9c1d-7e8f0a2b3c4d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  eventId!: string;

  @ApiProperty({ example: 'usr_2N9k8xQpL3vM5Rb1Tw7yZc' })
  userId!: string;

  @ApiProperty({ enum: PLANNING_ROLES, example: 'contributor' })
  role!: (typeof PLANNING_ROLES)[number];

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  joinedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    description:
      "The member who invited this user. Null for the event creator (auto-added as first admin).",
    example: 'usr_1A2b3C4d5E6f7G8h9I0jKl',
  })
  invitedById!: string | null;

  @ApiProperty({ type: PlanningMemberUserDto })
  user!: PlanningMemberUserDto;
}

// ── Planning invitation (admin view) ───────────────────────────────────

export class PlanningInvitationDto {
  @ApiProperty({ format: 'uuid', example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  eventId!: string;

  @ApiProperty({ example: 'bola@example.com' })
  email!: string;

  @ApiProperty({ enum: PLANNING_ROLES, example: 'contributor' })
  role!: (typeof PLANNING_ROLES)[number];

  @ApiProperty({ enum: INVITATION_STATUSES, example: 'pending' })
  status!: (typeof INVITATION_STATUSES)[number];

  @ApiProperty({ example: '2026-06-09T08:12:00.000Z' })
  expiresAt!: string;

  @ApiProperty({
    example: 'usr_1A2b3C4d5E6f7G8h9I0jKl',
    description: 'User id of the admin who sent the invitation.',
  })
  inviterId!: string;

  @ApiProperty({ example: '2026-06-02T08:12:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: null,
    description: 'Timestamp the recipient accepted; null while pending/declined/revoked/expired.',
  })
  acceptedAt!: string | null;
}

// ── Invite-member response (admin POST result) ─────────────────────────

/**
 * Returned by POST /events/:eventId/members/invitations. Wraps the standard
 * invitation row with extras the admin needs to fall back to manual sharing
 * when email delivery is unreliable (Resend sandbox limits, bounces, etc.).
 */
export class InviteMemberResponseDto extends PlanningInvitationDto {
  @ApiProperty({
    example: 'https://app.epdema.com/invitations/3f9c1e7b8a2d4f5e6c0b9a1d2e3f4a5b',
    description:
      'Full URL the recipient can use to accept. Same token is in the email; admins copy this to share manually.',
  })
  acceptUrl!: string;

  @ApiProperty({
    example: true,
    description: 'Whether the invitation email was sent successfully (best-effort).',
  })
  emailSent!: boolean;

  @ApiPropertyOptional({
    description: 'Error message if email delivery failed; absent on success.',
    example: 'Resend sandbox: recipient not on allowlist',
  })
  emailError?: string;
}

// ── Public invitation lookup (token-gated, unauthenticated) ────────────

export class PublicInvitationEventDto {
  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  id!: string;

  @ApiProperty({ example: 'Tunde & Bola — Wedding' })
  title!: string;

  @ApiProperty({ example: 'wedding' })
  eventType!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-06-24',
    description: 'YYYY-MM-DD; null when no date is locked yet.',
  })
  scheduledDate!: string | null;
}

export class PublicInvitationInviterDto {
  @ApiProperty({ example: 'usr_1A2b3C4d5E6f7G8h9I0jKl' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Adebayo' })
  name!: string | null;

  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;
}

/**
 * Shape returned by the public GET /invitations/:token endpoint. Trimmed
 * version of the full invitation — only the recipient's own email, the event
 * title/type/date, and inviter contact info. No internal ids beyond what the
 * recipient needs to decide whether to accept.
 */
export class PublicInvitationDto {
  @ApiProperty({ format: 'uuid', example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  id!: string;

  @ApiProperty({ example: 'bola@example.com' })
  email!: string;

  @ApiProperty({ enum: PLANNING_ROLES, example: 'contributor' })
  role!: (typeof PLANNING_ROLES)[number];

  @ApiProperty({ enum: INVITATION_STATUSES, example: 'pending' })
  status!: (typeof INVITATION_STATUSES)[number];

  @ApiProperty({ example: '2026-06-09T08:12:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ type: PublicInvitationEventDto })
  event!: PublicInvitationEventDto;

  @ApiProperty({ type: PublicInvitationInviterDto })
  inviter!: PublicInvitationInviterDto;
}

// ── Accept-invitation result ───────────────────────────────────────────

/**
 * Returned by POST /invitations/:token/accept. Minimal — the client uses the
 * eventId to redirect into the planning room.
 */
export class AcceptInvitationResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9',
    description: 'Event the user is now a planning member of.',
  })
  eventId!: string;
}
