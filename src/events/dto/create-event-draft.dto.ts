import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const EVENT_TYPES = [
  'wedding',
  'birthday',
  'offsite',
  'hangout',
  'conference',
  'reunion',
  'fundraiser',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export class CreateEventDraftDto {
  @ApiProperty({ example: 'Wedding planning — Tunde & Bola', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ enum: EVENT_TYPES, example: 'wedding' })
  @IsIn(EVENT_TYPES as unknown as string[])
  eventType!: EventType;

  @ApiPropertyOptional({ description: 'Provisional event date; can change while planning.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledDate?: Date;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
