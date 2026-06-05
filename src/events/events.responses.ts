import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the events controller. The runtime
 * serializer (`events.serializer.ts`) returns plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole job
 * is to give the OpenAPI spec a typed body schema so codegen produces real
 * types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

export class EventAddonRefDto {
  @ApiProperty({ example: 'anonymous_proposals' })
  slug!: string;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  createdAt!: string;
}

export class EventResponseDto {
  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  id!: string;

  @ApiProperty({ example: 'usr_2N9k8x...' })
  creatorId!: string;

  @ApiProperty({ example: 'Tunde & Bola — Wedding' })
  title!: string;

  @ApiProperty({ example: 'wedding' })
  eventType!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Outdoor evening reception, ~120 guests.' })
  description!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-06-24',
    description: 'YYYY-MM-DD; null when no date is locked yet.',
  })
  scheduledDate!: string | null;

  @ApiProperty({
    example: 'draft',
    enum: ['draft', 'planning', 'published', 'past', 'archived'],
  })
  state!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'occasion' })
  tierSlug!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Tier-derived feature bag. Shape: { sharing: {...}, branding: {...}, invitees: {...}, … }.',
    example: {
      sharing: { emailReminders: true, customSlug: true },
      branding: { customSharePage: false },
      invitees: { maxInvitees: 200, customQuestions: 5 },
    },
  })
  features!: Record<string, unknown>;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'tunde-bola' })
  shareSlug!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: null })
  customSubdomain!: string | null;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  updatedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: null })
  provisionedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: null })
  publishedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: null })
  archivedAt!: string | null;

  @ApiProperty({ type: [EventAddonRefDto] })
  addons!: EventAddonRefDto[];

  @ApiPropertyOptional({
    enum: ['admin', 'contributor', 'observer'],
    description:
      "The viewing user's role on this event. Populated on single-event reads " +
      '(GET /:id) and after mutations; absent on list responses.',
  })
  currentUserRole?: 'admin' | 'contributor' | 'observer';
}

// ── Publish-readiness ──────────────────────────────────────────────────

export class PublishBlockerDto {
  @ApiProperty({
    enum: [
      'state_not_publishable',
      'no_scheduled_date',
      'no_segments',
      'unlocked_segments',
      'odd_voting_count',
    ],
    example: 'unlocked_segments',
  })
  kind!: string;

  @ApiPropertyOptional({
    description: 'Free-form details about the blocker (e.g. which segment is unlocked).',
    type: 'object',
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}

export class PublishReadinessCountsDto {
  @ApiProperty({ example: 6 })
  totalSegments!: number;

  @ApiProperty({ example: 5 })
  lockedSegments!: number;

  @ApiProperty({ example: 4 })
  planningMembers!: number;
}

export class PublishReadinessResponseDto {
  @ApiProperty({ example: false })
  ready!: boolean;

  @ApiProperty({ type: [PublishBlockerDto] })
  blockers!: PublishBlockerDto[];

  @ApiProperty({ type: PublishReadinessCountsDto })
  counts!: PublishReadinessCountsDto;
}
