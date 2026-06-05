import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Format rules for a custom share slug.
 *
 *   - 3-64 chars
 *   - lowercase letters, digits, single hyphens
 *   - must start + end with a letter or digit (no leading/trailing/consecutive hyphens)
 *
 * Reserved words (api, admin, auth, share, rsvp, etc.) are enforced server-side
 * in EventsService — the regex only handles syntax.
 */
export const SHARE_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;

export class RenameShareSlugDto {
  @ApiProperty({
    description:
      "New share slug. Lowercase letters, digits, and single hyphens, 3-64 chars. " +
      "Reserved words (api, admin, etc.) are rejected.",
    minLength: 3,
    maxLength: 64,
    example: 'tundes-30th',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(SHARE_SLUG_REGEX, {
    message:
      'Slug must be lowercase letters, digits, and single hyphens (no leading/trailing/consecutive hyphens), 3-64 chars.',
  })
  slug!: string;
}
