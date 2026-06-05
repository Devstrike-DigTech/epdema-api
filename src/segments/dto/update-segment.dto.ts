import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Update an existing segment's title / description / type. Position is changed
 * via the bulk reorder endpoint; locked-state is changed via lock/unlock.
 */
export class UpdateSegmentDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  segmentType?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Pass empty string to clear.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
