import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { GIS_LAYER_KINDS } from '../entities/map-layer.entity';

export class ListLayersDto {
  @ApiPropertyOptional({ enum: GIS_LAYER_KINDS })
  @IsOptional()
  @IsIn(GIS_LAYER_KINDS)
  kind?: (typeof GIS_LAYER_KINDS)[number];

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  incidentId?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  publicOnly?: string;
}
