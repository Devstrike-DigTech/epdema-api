import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuggestProposalsDto {
  @ApiPropertyOptional({
    description:
      'Optional free-form steer for the suggestions — e.g. "focus on Lagos vendors", "outdoor only", "stay under ₦300k".',
    example: 'focus on outdoor venues',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  steer?: string;
}
