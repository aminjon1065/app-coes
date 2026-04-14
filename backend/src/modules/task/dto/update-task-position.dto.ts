import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateTaskPositionDto {
  @ApiProperty({ minimum: 0, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position: number;
}
