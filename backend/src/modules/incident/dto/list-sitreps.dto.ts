import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListSitrepsDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor in format <ISO timestamp>|<uuid>',
  })
  @IsOptional()
  @IsString()
  @Matches(/.+\|.+/)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
