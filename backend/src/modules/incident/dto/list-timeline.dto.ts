import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ListTimelineDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor in format <ISO timestamp>|<uuid>',
  })
  @IsOptional()
  @IsString()
  @Matches(/.+\|.+/)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
