import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export const TASK_TRANSITIONS = [
  'start',
  'block',
  'unblock',
  'submit_for_review',
  'complete',
  'approve',
  'reject',
  'cancel',
] as const;

export class TransitionTaskStatusDto {
  @ApiProperty({ enum: TASK_TRANSITIONS })
  @IsEnum(TASK_TRANSITIONS)
  transition: (typeof TASK_TRANSITIONS)[number];

  @ApiPropertyOptional({ example: 'Road access is blocked by debris.' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
