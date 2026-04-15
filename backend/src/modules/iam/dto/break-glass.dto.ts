import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const BREAK_GLASS_ROLE_CODES = [
  'incident_commander',
  'shift_lead',
  'tenant_admin',
] as const;

export class ActivateBreakGlassDto {
  @ApiProperty()
  @IsUUID()
  targetUserId: string;

  @ApiProperty({ enum: BREAK_GLASS_ROLE_CODES, example: 'incident_commander' })
  @IsString()
  @IsIn(BREAK_GLASS_ROLE_CODES)
  roleCode: (typeof BREAK_GLASS_ROLE_CODES)[number];

  @ApiProperty({
    example: 'Primary commander unreachable during escalation window.',
  })
  @IsString()
  @Length(12, 500)
  reason: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 4, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  durationHours?: number;
}
