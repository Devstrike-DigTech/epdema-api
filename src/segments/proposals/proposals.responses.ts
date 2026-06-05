import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the proposals controller. The runtime
 * serializer (`serializers.ts`) returns plain objects whose inferred shape
 * matches these classes — we never instantiate them. Their sole job is to
 * give the OpenAPI spec a typed body schema so codegen produces real types
 * instead of `unknown`.
 */

export class ProposalProposedByDto {
  @ApiProperty({ example: 'usr_2N9k8x4QyT3pA7c1bWv0eR' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Amaka Okonkwo' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'amaka@example.com' })
  email!: string | null;
}

export class ProposalObjectionRaisedByDto {
  @ApiProperty({ example: 'usr_3K9p1y2Mn8oW5dC7eUj4tZ' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Bola Adeyemi' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'bola@example.com' })
  email!: string | null;
}

export class ProposalObjectionDto {
  @ApiProperty({ format: 'uuid', example: '7c0b4a30-2f1d-4b3c-8e9a-1a2b3c4d5e6f' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  proposalId!: string;

  @ApiProperty({ example: 'usr_3K9p1y2Mn8oW5dC7eUj4tZ' })
  raisedById!: string;

  @ApiProperty({ type: ProposalObjectionRaisedByDto })
  raisedBy!: ProposalObjectionRaisedByDto;

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

export class ProposalResponseDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: 'e3b0c442-98fc-4e1b-9c2b-9d3a7c2f1a4d' })
  segmentId!: string;

  @ApiProperty({ example: 'usr_2N9k8x4QyT3pA7c1bWv0eR' })
  proposedById!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: ProposalProposedByDto,
    description:
      "Null when the proposal is anonymous (event has the 'anonymous_proposals' add-on enabled).",
  })
  proposedBy!: ProposalProposedByDto | null;

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

  @ApiProperty({ type: [ProposalObjectionDto] })
  objections!: ProposalObjectionDto[];
}
