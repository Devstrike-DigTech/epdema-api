import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the segments controller. The runtime
 * serializer (`segments.serializer.ts`) returns plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole job
 * is to give the OpenAPI spec a typed body schema so codegen produces real
 * types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

// ── User refs ──────────────────────────────────────────────────────────

export class UserRefDto {
  @ApiProperty({ example: 'usr_2N9k8x4QyT3pA7c1bWv0eR' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Amaka Okonkwo' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'amaka@example.com' })
  email!: string | null;
}

// ── Segment ────────────────────────────────────────────────────────────

export class SegmentResponseDto {
  @ApiProperty({ format: 'uuid', example: 'e3b0c442-98fc-4e1b-9c2b-9d3a7c2f1a4d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  eventId!: string;

  @ApiProperty({
    example: 'venue',
    description:
      "Free-form short slug ('date_time' | 'venue' | 'budget' | 'agenda' | 'guest_list' | " +
      "'roles' | 'theme' | 'travel' | …). Drives the picker icon on the planning board.",
  })
  segmentType!: string;

  @ApiProperty({ example: 'Reception venue' })
  title!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'Outdoor garden venue within 30 minutes of the church, capacity 120+.',
  })
  description!: string | null;

  @ApiProperty({ example: 2, description: 'Zero-based ordering within the event.' })
  position!: number;

  @ApiProperty({
    example: 'open',
    enum: ['seeded', 'open', 'proposed', 'objected', 'converging', 'single_remaining', 'locked'],
  })
  state!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Final decided payload once the segment is locked. Shape varies by ' +
      'segmentType (e.g. a venue payload has { name, address, capacity }).',
    example: {
      name: 'Garden Court Hotel',
      address: '12 Marina Way, Lagos',
      capacity: 150,
    },
  })
  lockedValue!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-05-28T14:33:12.000Z' })
  lockedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'usr_2N9k8x4QyT3pA7c1bWv0eR' })
  lockedById!: string | null;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  updatedAt!: string;
}

// ── Objection (embedded in proposal) ───────────────────────────────────

export class EmbeddedObjectionDto {
  @ApiProperty({ format: 'uuid', example: '7c0b4a30-2f1d-4b3c-8e9a-1a2b3c4d5e6f' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  proposalId!: string;

  @ApiProperty({ example: 'usr_3K9p1y2Mn8oW5dC7eUj4tZ' })
  raisedById!: string;

  @ApiProperty({ type: UserRefDto })
  raisedBy!: UserRefDto;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'Capacity is too tight if we keep the plus-ones list as is.',
  })
  reason!: string | null;

  @ApiProperty({ example: 'live', enum: ['live', 'withdrawn'] })
  state!: string;

  @ApiProperty({ example: '2026-05-27T09:01:14.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-27T09:01:14.000Z' })
  updatedAt!: string;
}

// ── Proposal (embedded in segment detail) ──────────────────────────────

export class EmbeddedProposalDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: 'e3b0c442-98fc-4e1b-9c2b-9d3a7c2f1a4d' })
  segmentId!: string;

  @ApiProperty({ example: 'usr_2N9k8x4QyT3pA7c1bWv0eR' })
  proposedById!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: UserRefDto,
    description:
      "Null when the proposal is anonymous (event has the 'anonymous_proposals' add-on enabled).",
  })
  proposedBy!: UserRefDto | null;

  @ApiProperty({ example: false })
  anonymous!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Shape depends on the parent segment.segmentType — validated server-side per type. ' +
      'E.g. a venue proposal has { name, address, capacity }; a date_time proposal has { date, startsAt }.',
    example: {
      name: 'Garden Court Hotel',
      address: '12 Marina Way, Lagos',
      capacity: 150,
    },
  })
  payload!: Record<string, unknown>;

  @ApiProperty({
    example: 'live',
    enum: ['live', 'withdrawn', 'eliminated', 'winner'],
  })
  state!: string;

  @ApiProperty({ example: '2026-05-26T10:22:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-26T10:22:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ type: [EmbeddedObjectionDto] })
  objections!: EmbeddedObjectionDto[];
}

// ── Segment detail (segment + proposals + objections) ──────────────────

export class SegmentDetailResponseDto extends SegmentResponseDto {
  @ApiProperty({ type: [EmbeddedProposalDto] })
  proposals!: EmbeddedProposalDto[];
}
