import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignTaskDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assigneeId: string;

  @ApiPropertyOptional({ example: 'Field team lead for Sector 4' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
