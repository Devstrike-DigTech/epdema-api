import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the objections controller. The runtime
 * serializer (`serializers.ts`) returns plain objects whose inferred shape
 * matches these classes — we never instantiate them. Their sole job is to
 * give the OpenAPI spec a typed body schema so codegen produces real types
 * instead of `unknown`.
 */

export class ObjectionRaisedByDto {
  @ApiProperty({ example: 'usr_3K9p1y2Mn8oW5dC7eUj4tZ' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Bola Adeyemi' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'bola@example.com' })
  email!: string | null;
}

export class ObjectionResponseDto {
  @ApiProperty({ format: 'uuid', example: '7c0b4a30-2f1d-4b3c-8e9a-1a2b3c4d5e6f' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  proposalId!: string;

  @ApiProperty({ example: 'usr_3K9p1y2Mn8oW5dC7eUj4tZ' })
  raisedById!: string;

  @ApiProperty({ type: ObjectionRaisedByDto })
  raisedBy!: ObjectionRaisedByDto;

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
