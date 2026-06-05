import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class LockSegmentDto {
  @ApiProperty({ description: 'The proposal that wins. Must belong to this segment and be live with zero live objections.' })
  @IsUUID()
  proposalId!: string;
}

export class UnlockSegmentDto {
  @ApiPropertyOptional({
    description: 'Optional human-readable reason for unlocking. Strongly encouraged for audit clarity.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
