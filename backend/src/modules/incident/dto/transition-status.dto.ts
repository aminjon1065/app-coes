import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const INCIDENT_TRANSITIONS = [
  'open',
  'escalate',
  'de_escalate',
  'contain',
  'close',
  'reopen',
  'archive',
] as const;

export class TransitionStatusDto {
  @ApiProperty({ enum: INCIDENT_TRANSITIONS })
  @IsEnum(INCIDENT_TRANSITIONS)
  transition: (typeof INCIDENT_TRANSITIONS)[number];

  @ApiPropertyOptional({ example: 'Updated field reports require escalation to national coordination.' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;

  @ApiPropertyOptional({ example: 'All response units demobilized and final report approved.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  resolutionSummary?: string;
}
