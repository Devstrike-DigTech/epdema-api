import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 7·F — partial update for the authenticated user's profile.
 * All fields optional; only the ones present mutate the row. `displayName`,
 * `phone`, `city` already existed on `user_profile` but had no surface to
 * edit — we expose them here too so the same endpoint covers Settings.
 *
 * `ratingVisible` is the headline addition: when false, public surfaces
 * (the share page) omit the creator's rating entirely.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description:
      'When false, public surfaces (share page) omit your rating entirely. ' +
      'Default true — opt-out, not opt-in, since the rating is the trust signal.',
  })
  @IsOptional()
  @IsBoolean()
  ratingVisible?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;
}
