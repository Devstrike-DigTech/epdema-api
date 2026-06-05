import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the users controller. The controller
 * returns a plain object shaped like these classes — we never instantiate
 * them. Their sole job is to give the OpenAPI spec a typed body schema so
 * codegen produces real types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file. Update it when the controller's return shape changes.
 */

export class UserProfileDto {
  @ApiProperty({ example: 'usr_2N9k8x...' })
  userId!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Bakare' })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '+2348012345678' })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Lagos' })
  city!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '4.75',
    description: 'Average rating as a decimal string (Prisma Decimal serializes to string).',
  })
  ratingAvg!: string | null;

  @ApiProperty({ example: 12 })
  ratingCount!: number;

  @ApiProperty({ example: true })
  ratingVisible!: boolean;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  updatedAt!: string;
}

export class CurrentUserResponseDto {
  @ApiProperty({ example: 'usr_2N9k8x...' })
  id!: string;

  @ApiProperty({ example: 'organizer@example.com' })
  email!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Tunde Bakare' })
  name?: string | null;

  @ApiPropertyOptional({ example: true })
  emailVerified?: boolean;

  @ApiProperty({
    type: UserProfileDto,
    description: 'EPDEMA-side profile row. Auto-created on first /users/me call.',
  })
  profile!: UserProfileDto;
}
