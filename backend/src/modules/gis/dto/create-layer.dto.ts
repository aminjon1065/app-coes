import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { GIS_LAYER_KINDS } from '../entities/map-layer.entity';

export class CreateLayerDto {
  @ApiProperty({ enum: GIS_LAYER_KINDS, example: 'RESOURCE' })
  @IsIn(GIS_LAYER_KINDS)
  kind: (typeof GIS_LAYER_KINDS)[number];

  @ApiProperty({ example: 'North Sector Resources' })
  @IsString()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ example: 'Active field resources in the northern sector.' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  incidentId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
