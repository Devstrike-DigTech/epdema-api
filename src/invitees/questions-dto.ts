import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const RSVP_QUESTION_TYPES = ['text', 'select'] as const;
export type RsvpQuestionType = (typeof RSVP_QUESTION_TYPES)[number];

/**
 * One custom RSVP question. The `id` is admin-supplied (so the editor can
 * rename a question without invalidating prior answers) — we just enforce it's
 * a short slug-ish string. The frontend generates this with nanoid().
 */
export class RsvpQuestionDto {
  @ApiProperty({ example: 'dietary' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Question id must be letters, digits, underscores, or hyphens only.',
  })
  id!: string;

  @ApiProperty({ example: 'Any dietary requirements?', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: RSVP_QUESTION_TYPES })
  @IsIn(RSVP_QUESTION_TYPES as unknown as string[])
  type!: RsvpQuestionType;

  /** Required only when `type === 'select'`. Up to 8 options, each ≤ 80 chars. */
  @ApiPropertyOptional({ type: [String], maxItems: 8 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];

  @ApiProperty()
  @IsBoolean()
  required!: boolean;
}

export class SetRsvpQuestionsDto {
  @ApiProperty({
    type: [RsvpQuestionDto],
    description:
      'Full replacement of the question set. Pass [] to remove all questions. ' +
      "Server validates 'select' questions have ≥1 option and tier cap (Occasion=3, Production=10, Marquee=∞).",
  })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50) // hard ceiling regardless of tier
  @ValidateNested({ each: true })
  @Type(() => RsvpQuestionDto)
  questions!: RsvpQuestionDto[];
}
