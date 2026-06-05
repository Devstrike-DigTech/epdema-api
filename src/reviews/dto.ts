import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitReviewDto {
  @ApiProperty({
    minimum: 1,
    maximum: 5,
    example: 5,
    description: '1-5 stars.',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    maxLength: 2000,
    example:
      'Tunde organised every segment crisply — the proposal-objection rhythm meant nobody felt steamrolled.',
    description:
      "Optional free-form comment. Only visible to the event creator (visibility rule per Phase 7 plan — public surface shows the aggregate only).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
