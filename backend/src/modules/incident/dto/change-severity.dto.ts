import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class ChangeSeverityDto {
  @ApiProperty({ minimum: 1, maximum: 4, example: 3 })
  @IsInt()
  @Min(1)
  @Max(4)
  severity: number;

  @ApiProperty({
    example: 'Updated field assessment confirms broader impact radius.',
  })
  @IsString()
  @Length(1, 2000)
  reason: string;
}
