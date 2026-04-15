import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SitrepLocationDto {
  @ApiProperty({ example: 38.5598 })
  @Type(() => Number)
  lat: number;

  @ApiProperty({ example: 68.787 })
  @Type(() => Number)
  lon: number;
}

export class SubmitSitrepDto {
  @ApiProperty({
    example:
      'Water level continues to rise. Evacuation of sector B has started.',
  })
  @IsString()
  @Length(1, 10000)
  text: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 4, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  severity?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  attachments?: string[];

  @ApiPropertyOptional({
    type: SitrepLocationDto,
    description: 'Optional point location for the report.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SitrepLocationDto)
  location?: SitrepLocationDto;
}
