import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the public share controller. The runtime
 * serializer (`share.serializer.ts`) returns plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole job
 * is to give the OpenAPI spec a typed body schema so codegen produces real
 * types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

export class PublicDecisionDto {
  @ApiProperty({ format: 'uuid', example: 'd8a4c1a2-9b6e-4f5b-9c1a-2d8b6e4f5b9c' })
  id!: string;

  @ApiProperty({ example: 'Ceremony venue' })
  title!: string;

  @ApiProperty({ example: 'venue' })
  segmentType!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Outdoor garden ceremony at sunset.' })
  description!: string | null;

  @ApiProperty({ example: 0 })
  position!: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'The locked decision payload. Shape varies by segmentType (venue, time, menu, …).',
    example: { name: 'Sunset Gardens', address: '12 Awolowo Rd, Ikoyi, Lagos' },
  })
  value!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-05-26T08:12:00.000Z' })
  decidedAt!: string | null;
}

export class PublicCreatorDto {
  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Adebayo' })
  name!: string | null;

  /**
   * Phase 7·F — creator's average rating, surfaced ONLY when
   *   (1) `user_profile.ratingVisible` is not explicitly false, AND
   *   (2) `ratingCount > 0`.
   *
   * `null` means "do not display" (covers both visibility-off and
   * no-reviews-yet). The decimal-as-string format matches `/users/me`.
   */
  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '4.6',
    description:
      'Decimal-as-string. `null` when the creator opted out of public ' +
      'rating OR has zero reviews. Use together with `ratingCount`.',
  })
  ratingAvg!: string | null;

  /**
   * Number of reviews behind `ratingAvg`. `0` when hidden or unreviewed —
   * never a positive number with a null avg.
   */
  @ApiProperty({
    example: 12,
    description:
      'Always paired with `ratingAvg`. `0` here = "hide the badge entirely" ' +
      'on the public page.',
  })
  ratingCount!: number;
}

export class PublicBrandDto {
  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#4A2B7E' })
  color!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#F2C94C' })
  accentColor!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '#1A1A1A' })
  textColor!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'http://localhost:3001/uploads/events/6bb69700-72eb-40a0-b37e-e6c0b8b004a9/logo-9f3a.png',
  })
  logoUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'http://localhost:3001/uploads/events/6bb69700-72eb-40a0-b37e-e6c0b8b004a9/cover-2c7d.jpg',
  })
  coverImageUrl!: string | null;
}

export class PublicShareResponseDto {
  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  id!: string;

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
    example: 'published',
    enum: ['draft', 'planning', 'published', 'past', 'archived'],
  })
  state!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'tunde-bola' })
  shareSlug!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-05-26T08:12:00.000Z' })
  publishedAt!: string | null;

  @ApiProperty({ type: PublicCreatorDto })
  creator!: PublicCreatorDto;

  @ApiProperty({ type: [PublicDecisionDto] })
  decisions!: PublicDecisionDto[];

  @ApiPropertyOptional({
    type: PublicBrandDto,
    nullable: true,
    description:
      'Custom brand for the share page. Null when the event tier does not grant ' +
      'custom branding, or when the organizer has not configured anything.',
  })
  brand!: PublicBrandDto | null;
}
