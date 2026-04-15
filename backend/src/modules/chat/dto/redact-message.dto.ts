import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RedactMessageDto {
  @ApiProperty({ example: 'PII leaked in free-text' })
  @IsString()
  @MaxLength(1_000)
  reason: string;
}
