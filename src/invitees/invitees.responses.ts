import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the invitees + rsvp controllers. The
 * runtime serializers (`serializers.ts`) return plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole job is
 * to give the OpenAPI spec a typed body schema so codegen produces real types
 * instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

// ── Invitee (admin view) ───────────────────────────────────────────────

export const INVITEE_STATUSES = ['pending', 'yes', 'no', 'maybe'] as const;

export class InviteeAdminDto {
  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '4f4f1f6a-a7ed-4d8a-9a44-5bb2a3ce4a3e' })
  eventId!: string;

  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Olamide' })
  name!: string | null;

  @ApiProperty({ enum: INVITEE_STATUSES, example: 'pending' })
  status!: (typeof INVITEE_STATUSES)[number];

  @ApiProperty({
    example: 'aBcD1234EFgh5678IJklMNop9012QrSt',
    description:
      'Unguessable base64url token (~32 chars) — admin can reshare out-of-band if email failed.',
  })
  rsvpToken!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    example: { dietary: 'Vegetarian', plusOne: 'Yes' },
    description: 'Answers to custom RSVP questions, keyed by question id.',
  })
  customAnswers!: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'usr_2N9k8x...' })
  addedById!: string | null;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  addedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-05-27T09:00:00.000Z',
    description: 'When the invitation email was sent; null if not yet invited.',
  })
  invitedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-05-28T14:32:00.000Z',
    description: 'When the invitee submitted their RSVP; null if still pending.',
  })
  respondedAt!: string | null;
}

// ── Counts ─────────────────────────────────────────────────────────────

export class InviteeStatusCountsDto {
  @ApiProperty({ example: 24 })
  pending!: number;

  @ApiProperty({ example: 87 })
  yes!: number;

  @ApiProperty({ example: 9 })
  no!: number;

  @ApiProperty({ example: 5 })
  maybe!: number;

  @ApiProperty({ example: 125 })
  total!: number;
}

// ── Add / bulk-add results ─────────────────────────────────────────────

export const ADD_INVITEE_OUTCOMES = [
  'created',
  'updated',
  'skipped_existing',
  'invalid',
] as const;

export class AddInviteeResultDto {
  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;

  @ApiProperty({ enum: ADD_INVITEE_OUTCOMES, example: 'created' })
  outcome!: (typeof ADD_INVITEE_OUTCOMES)[number];

  @ApiPropertyOptional({
    format: 'uuid',
    example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9',
    description: 'Present when outcome is created/updated/skipped_existing.',
  })
  inviteeId?: string;

  @ApiPropertyOptional({
    example: 'Not a valid email.',
    description: 'Present when outcome is invalid or skipped_existing (duplicate in batch).',
  })
  reason?: string;
}

export class AddInviteesResponseDto {
  @ApiProperty({ type: [AddInviteeResultDto] })
  results!: AddInviteeResultDto[];
}

// ── Send invitations ───────────────────────────────────────────────────

export class SendInvitationResultDto {
  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;

  @ApiProperty({ example: true })
  sent!: boolean;

  @ApiPropertyOptional({
    example: 'Resend API error: invalid recipient',
    description: 'Present when sent=false; the underlying delivery error message.',
  })
  error?: string;
}

export class SendInvitationsSummaryDto {
  @ApiProperty({ example: 12 })
  attempted!: number;

  @ApiProperty({ example: 11 })
  succeeded!: number;

  @ApiProperty({ example: 1 })
  failed!: number;
}

export class SendInvitationsResponseDto {
  @ApiProperty({ type: [SendInvitationResultDto] })
  results!: SendInvitationResultDto[];

  @ApiProperty({ type: SendInvitationsSummaryDto })
  summary!: SendInvitationsSummaryDto;
}

// ── RSVP questions ─────────────────────────────────────────────────────

export const RSVP_QUESTION_TYPES = ['text', 'select'] as const;

/**
 * Response-side mirror of the request DTO in `questions-dto.ts`. Kept
 * separate so request validation decorators don't bleed into the response
 * schema (different concern; the OpenAPI generator picks up the request
 * one for inbound bodies and this one for outbound payloads).
 */
export class RsvpQuestionDto {
  @ApiProperty({ example: 'dietary' })
  id!: string;

  @ApiProperty({ example: 'Any dietary requirements?' })
  label!: string;

  @ApiProperty({ enum: RSVP_QUESTION_TYPES, example: 'select' })
  type!: (typeof RSVP_QUESTION_TYPES)[number];

  @ApiPropertyOptional({
    type: [String],
    example: ['None', 'Vegetarian', 'Vegan', 'Halal'],
    description: 'Present when type=select; the choices an invitee can pick.',
  })
  options?: string[];

  @ApiProperty({ example: true })
  required!: boolean;
}

export class RsvpQuestionsResponseDto {
  @ApiProperty({ type: [RsvpQuestionDto] })
  questions!: RsvpQuestionDto[];
}

// ── Scheduled reminders ────────────────────────────────────────────────

export const REMINDER_KINDS = ['rsvp_nudge', 'event_tomorrow'] as const;
export const REMINDER_STATUSES = [
  'scheduled',
  'sent',
  'cancelled',
  'failed',
  'skipped',
] as const;

export class ScheduledReminderDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '4f4f1f6a-a7ed-4d8a-9a44-5bb2a3ce4a3e' })
  eventId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: 'string',
    example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9',
    description: 'Null for event-wide reminders (e.g. event_tomorrow broadcasts).',
  })
  inviteeId!: string | null;

  @ApiProperty({ enum: REMINDER_KINDS, example: 'rsvp_nudge' })
  kind!: (typeof REMINDER_KINDS)[number];

  @ApiProperty({ example: '2026-06-21T09:00:00.000Z' })
  runAt!: string;

  @ApiProperty({ enum: REMINDER_STATUSES, example: 'scheduled' })
  status!: (typeof REMINDER_STATUSES)[number];

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-06-21T09:00:12.000Z',
    description: 'When the reminder actually fired; null until status=sent.',
  })
  sentAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'Resend API timeout',
    description: 'Failure detail; populated when status=failed.',
  })
  error!: string | null;
}

export class RemindersListResponseDto {
  @ApiProperty({ type: [ScheduledReminderDto] })
  reminders!: ScheduledReminderDto[];
}

export class CancelRemindersResponseDto {
  @ApiProperty({
    example: 7,
    description: 'How many scheduled reminders were transitioned to cancelled.',
  })
  cancelled!: number;
}

// ── Public RSVP view (token-gated) ─────────────────────────────────────

export class PublicRsvpInviteeDto {
  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  id!: string;

  @ApiProperty({ example: 'tunde@example.com' })
  email!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Olamide' })
  name!: string | null;

  @ApiProperty({ enum: INVITEE_STATUSES, example: 'pending' })
  status!: (typeof INVITEE_STATUSES)[number];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    example: { dietary: 'Vegetarian' },
  })
  customAnswers!: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-05-28T14:32:00.000Z' })
  respondedAt!: string | null;
}

/**
 * Public-safe brand payload. Returned `null` from the lookup endpoint when the
 * event's tier doesn't grant the customSharePage feature. Every field is
 * independently nullable because the organizer may have set, say, colors but
 * no logo.
 */
export class PublicBrandDto {
  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#1F2937' })
  color!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#F59E0B' })
  accentColor!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#FFFFFF' })
  textColor!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'https://cdn.epdema.com/brand/4f4f1f6a/logo.png',
  })
  logoUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'https://cdn.epdema.com/brand/4f4f1f6a/cover.jpg',
  })
  coverImageUrl!: string | null;
}

export class PublicRsvpEventDto {
  @ApiProperty({ format: 'uuid', example: '4f4f1f6a-a7ed-4d8a-9a44-5bb2a3ce4a3e' })
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

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Outdoor evening reception, ~120 guests.' })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'tunde-bola' })
  shareSlug!: string | null;

  @ApiProperty({ type: [RsvpQuestionDto] })
  rsvpQuestions!: RsvpQuestionDto[];

  @ApiPropertyOptional({
    type: PublicBrandDto,
    nullable: true,
    description:
      "Public brand payload — null when the event's tier doesn't grant the " +
      'customSharePage feature, otherwise the organizer\'s configured colors/logo/cover.',
  })
  brand!: PublicBrandDto | null;
}

export class PublicRsvpResponseDto {
  @ApiProperty({ type: PublicRsvpInviteeDto })
  invitee!: PublicRsvpInviteeDto;

  @ApiProperty({ type: PublicRsvpEventDto })
  event!: PublicRsvpEventDto;
}
