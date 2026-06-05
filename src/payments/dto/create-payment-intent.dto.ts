import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Draft event the payment provisions.' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ example: 'occasion', description: 'Slug of the chosen tier.' })
  @IsString()
  tierSlug!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['ai_vibe_pack', 'holiday_scanner'],
    description: 'Optional add-on slugs purchased alongside the tier.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  addonSlugs?: string[];

  @ApiPropertyOptional({
    description: 'Where Paystack redirects after hosted-checkout completes. Defaults to WEB_ORIGIN/events/:id/return.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackUrl?: string;
}
