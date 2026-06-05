import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Reserved for Phase 5c when custom slugs land on Occasion+ tier. */
export class PublishEventDto {
  @ApiPropertyOptional({ description: 'Reserved — custom share slug requires Occasion+ tier (Phase 5c).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customSlug?: string;
}

export class UnpublishEventDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
