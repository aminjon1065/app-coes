import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INCIDENT_CATEGORIES } from '../entities/incident.entity';

export class CreateIncidentDto {
  @ApiProperty({ example: 'Earthquake near Dushanbe city perimeter' })
  @IsString()
  @Length(3, 200)
  title: string;

  @ApiPropertyOptional({ example: 'Initial field reports indicate structural damage in two districts.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ enum: INCIDENT_CATEGORIES, example: 'earthquake' })
  @IsEnum(INCIDENT_CATEGORIES)
  category: (typeof INCIDENT_CATEGORIES)[number];

  @ApiProperty({ minimum: 1, maximum: 4, example: 3 })
  @IsInt()
  @Min(1)
  @Max(4)
  severity: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 4, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  classification?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  commanderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
