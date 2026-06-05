import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export class AddInviteeDto {
  @ApiProperty({ example: 'tunde@example.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ example: 'Tunde Olamide', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class BulkAddInviteesDto {
  @ApiProperty({
    type: [AddInviteeDto],
    description: 'Up to 500 invitees in one go. Server enforces tier max.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddInviteeDto)
  invitees!: AddInviteeDto[];
}

export class SubmitRsvpDto {
  @ApiProperty({ enum: RSVP_STATUSES })
  @IsIn(RSVP_STATUSES as unknown as string[])
  status!: RsvpStatus;

  @ApiPropertyOptional({ description: 'Reserved for Phase 5c custom RSVP questions.' })
  @IsOptional()
  customAnswers?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Optional name correction — used when an invitee was added by email only.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
