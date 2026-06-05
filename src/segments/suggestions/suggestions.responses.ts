import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SegmentSuggestionCandidateDto {
  @ApiProperty({ example: 'Garden venue at Lekki Conservation Centre' })
  summary!: string;

  @ApiProperty({
    example:
      'Outdoor garden with shaded marquee, capacity ~180. Public path nearby — lock 3-4pm Saturday to keep traffic light.',
  })
  notes!: string;

  @ApiProperty({
    example:
      'Matches your 24 Jun date (dry-season weekend) and the outdoor steer.',
  })
  reason!: string;

  @ApiPropertyOptional({
    description: 'Optional typed payload for segments where structured data fits.',
    type: 'object',
    additionalProperties: true,
    example: { capacity: 180, indoor: false, address: 'Lekki, Lagos' },
  })
  typed?: Record<string, unknown>;
}

export class SegmentSuggestionsResponseDto {
  @ApiProperty({ type: [SegmentSuggestionCandidateDto] })
  candidates!: SegmentSuggestionCandidateDto[];

  @ApiProperty({
    example: 4,
    description:
      "Cost of *this* call in USD cents. Surface a tiny '≈X¢' badge so the admin can see what each suggestion run spent.",
  })
  costCents!: number;
}
