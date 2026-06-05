import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const PLANNING_ROLES = ['admin', 'contributor', 'observer'] as const;
export type PlanningRole = (typeof PLANNING_ROLES)[number];

export class InviteMemberDto {
  @ApiProperty({ example: 'tunde@example.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  // No `default: 'contributor'` on the schema — that would make openapi-generator
  // emit a Dart enum with a private constructor (illegal). The service applies
  // the fallback when `role` is undefined.
  @ApiPropertyOptional({ enum: PLANNING_ROLES })
  @IsOptional()
  @IsIn(PLANNING_ROLES as unknown as string[])
  role?: PlanningRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: PLANNING_ROLES })
  @IsIn(PLANNING_ROLES as unknown as string[])
  role!: PlanningRole;
}

export class AcceptInvitationDto {
  @ApiPropertyOptional({ description: 'Reserved for future use.' })
  @IsOptional()
  @IsString()
  note?: string;
}
