import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopilotDraftSegmentDto {
  @ApiProperty({
    enum: ['date_time', 'venue', 'budget', 'agenda', 'guest_list', 'roles', 'theme', 'travel'],
    example: 'venue',
  })
  segmentType!: string;

  @ApiProperty({ example: 'Pick a venue' })
  title!: string;

  @ApiProperty({
    example:
      'Outdoor or rooftop venue in Lekki with capacity for 40, ideally one Bola has never been to.',
  })
  description!: string;
}

export class CopilotDraftResponseDto {
  @ApiProperty({ example: "Bola's surprise 30th" })
  title!: string;

  @ApiProperty({ example: 'birthday' })
  eventType!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: '2026-07-25',
    description: 'YYYY-MM-DD or null when the user was vague.',
  })
  scheduledDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example:
      "Surprise 30th for Bola — ~40 guests, Lekki, modest budget, last Saturday of July.",
  })
  description!: string | null;

  @ApiProperty({ type: [CopilotDraftSegmentDto] })
  segments!: CopilotDraftSegmentDto[];

  @ApiProperty({
    example: 18,
    description:
      "Cost of *this* call in USD cents (Opus is ~5x Sonnet so expect 10-30¢ a draft).",
  })
  costCents!: number;
}
