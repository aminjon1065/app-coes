import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_STATUSES,
} from '../entities/incident.entity';

export const INCIDENT_LIST_SORTS = [
  'newest',
  'updated',
  'severity_desc',
  'severity_asc',
  'code_asc',
] as const;

export class ListIncidentsDto {
  @ApiPropertyOptional({
    description: 'Search across incident code, title, and description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
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

  @ApiPropertyOptional({ enum: INCIDENT_LIST_SORTS, default: 'newest' })
  @IsOptional()
  @IsEnum(INCIDENT_LIST_SORTS)
  sort?: (typeof INCIDENT_LIST_SORTS)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
