import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

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
  limit?: number;
}
