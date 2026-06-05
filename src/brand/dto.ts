import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsOptional } from 'class-validator';

/**
 * Body for PUT /events/:id/brand. Only color fields — logo + cover come in
 * through dedicated multipart endpoints because they're files. All fields are
 * optional; omit a field to leave it untouched, or pass `null` to clear it
 * (handled in the service).
 */
export class UpdateBrandDto {
  @ApiProperty({
    required: false,
    nullable: true,
    example: '#4A2B7E',
    description: 'Primary brand color. Hex with leading #.',
  })
  @IsOptional()
  @IsHexColor({ message: 'color must be a hex color like #4A2B7E' })
  color?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '#F2B33E',
    description: 'Accent color for highlights, links, RSVP CTA.',
  })
  @IsOptional()
  @IsHexColor({ message: 'accentColor must be a hex color like #F2B33E' })
  accentColor?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '#1F1B2B',
    description: 'Text color for content sitting on top of the brand color.',
  })
  @IsOptional()
  @IsHexColor({ message: 'textColor must be a hex color like #1F1B2B' })
  textColor?: string | null;
}
