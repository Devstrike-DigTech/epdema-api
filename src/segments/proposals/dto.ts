import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 3b uses a generic shape: every proposal has a `summary` plus optional
 * `notes`. Phase 8 will add per-segment-type payload schemas (date, money,
 * structured agenda, etc.) — the column is `Json`, so we don't need a schema
 * migration to evolve the payload format.
 */
export class CreateProposalDto {
  @ApiProperty({
    description: 'Short summary of the proposed answer (e.g. "Lola\'s Rooftop, Yaba").',
    example: "Lola's Rooftop, Yaba",
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  summary!: string;

  @ApiPropertyOptional({
    description: 'Optional context — reasoning, links, cost estimate, capacity notes.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Reserved for Phase 8 typed payloads (e.g. date_time gets `{ start, end }`).
   * Accepted now but ignored unless the segment type maps to a typed shape.
   */
  @ApiPropertyOptional({ description: 'Optional structured payload (Phase 8+).' })
  @IsOptional()
  @IsObject()
  typed?: Record<string, unknown>;
}
