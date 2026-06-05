import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateObjectionDto {
  @ApiPropertyOptional({
    description: 'Optional reason for objecting. Strongly encouraged for productive deliberation.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
