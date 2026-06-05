import { ApiProperty } from '@nestjs/swagger';

export class HolidayWarningDto {
  @ApiProperty({
    enum: ['info', 'warning', 'critical'],
    example: 'warning',
    description:
      'info = worth-knowing context; warning = likely friction; critical = certain conflict.',
  })
  severity!: string;

  @ApiProperty({ example: 'Rainy season in Lagos' })
  title!: string;

  @ApiProperty({
    example:
      'June is peak rainy season — outdoor venues at risk. Consider a covered backup or shift to October.',
  })
  detail!: string;
}

export class HolidayScanResponseDto {
  @ApiProperty({ type: [HolidayWarningDto] })
  warnings!: HolidayWarningDto[];

  @ApiProperty({
    example: '2026-06-24',
    description:
      'The scheduledDate the scan was run against. The one-shot enforcement uses this so a date change unlocks a re-scan.',
  })
  scannedDate!: string;

  @ApiProperty({ example: 3, description: 'Cost of this call in USD cents. 0 on `latest()` reads.' })
  costCents!: number;
}
