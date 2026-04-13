import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_STATUSES,
} from '../entities/incident.entity';

export class ListIncidentsDto {
  @ApiPropertyOptional({ enum: INCIDENT_STATUSES })
  @IsOptional()
  @IsEnum(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];

  @ApiPropertyOptional({ enum: INCIDENT_CATEGORIES })
  @IsOptional()
  @IsEnum(INCIDENT_CATEGORIES)
  category?: (typeof INCIDENT_CATEGORIES)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  severity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
