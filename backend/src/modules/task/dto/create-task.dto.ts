import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Establish water distribution point at Sector 4' })
  @IsString()
  @Length(3, 300)
  title: string;

  @ApiPropertyOptional({ example: 'Coordinate logistics, volunteers, and security for the site.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 4, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  slaBreachAt?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
