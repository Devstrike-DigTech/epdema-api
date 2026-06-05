import { ApiProperty } from '@nestjs/swagger';

export class VibePackResponseDto {
  @ApiProperty({ example: 'Garden Twilight' })
  themeName!: string;

  @ApiProperty({
    type: [String],
    example: ['#4A2B7E', '#F2B33E', '#FAF7F2'],
    description:
      'Exactly 3 hex colors: [dominant, accent, text-on-dominant]. Auto-written to event.brand.',
  })
  palette!: string[];

  @ApiProperty({
    type: [String],
    example: [
      'String lights overhead in concentric loops',
      'Long shared table with mismatched candles',
    ],
  })
  decorations!: string[];

  @ApiProperty({
    type: [String],
    example: ['Afrobeats — Wizkid (Essence)', 'Highlife — Asa (Eye Adaba)'],
  })
  music!: string[];

  @ApiProperty({ example: '🌅' })
  emoji!: string;

  @ApiProperty({ example: 9, description: 'Cost of this call in USD cents.' })
  costCents!: number;

  @ApiProperty({
    example: true,
    description:
      "Whether event.brand color slots were also updated. True except in edge cases (e.g. parsing failed mid-write).",
  })
  brandApplied!: boolean;
}
