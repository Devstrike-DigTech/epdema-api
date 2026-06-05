import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Known segment types map to icons in the UI (web/segment-icons.tsx).
 * Anything else falls back to a generic icon — `segmentType` is a free-form
 * `varchar(32)` so users can invent their own categories without a migration.
 */
export class CreateSegmentDto {
  @ApiProperty({ example: 'Catering', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example: 'venue',
    description:
      "Type slug — drives the card icon. Use one of the known set (date_time, venue, budget, agenda, guest_list, roles, theme, travel) for a meaningful icon, or anything else for the generic fallback.",
    maxLength: 32,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  segmentType!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional explicit position. Defaults to the end of the list.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
