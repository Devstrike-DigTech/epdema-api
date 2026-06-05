import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response class for the admin brand controller. The runtime
 * serializer (`serializer.ts`) returns plain objects whose inferred shape
 * matches this class — we never instantiate it. Its sole job is to give the
 * OpenAPI spec a typed body schema so codegen produces real types instead
 * of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its serializer. Update both when a serializer changes.
 */
export class BrandResponseDto {
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
