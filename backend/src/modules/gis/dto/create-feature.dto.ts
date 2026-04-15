import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class GeoJsonGeometryDto {
  @ApiProperty({ example: 'Point' })
  @IsString()
  type: string;

  @ApiProperty({ example: [69.2401, 41.2995] })
  coordinates?: unknown;

  @ApiPropertyOptional({ type: [Object] })
  geometries?: GeoJsonGeometryDto[];
}

export class CreateFeatureDto {
  @ApiProperty({ type: GeoJsonGeometryDto })
  @ValidateNested()
  @Type(() => GeoJsonGeometryDto)
  geometry: GeoJsonGeometryDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Field hospital alpha' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  linkedIncidentId?: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  linkedTaskId?: string;
}
