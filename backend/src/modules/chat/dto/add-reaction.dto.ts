import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class AddReactionDto {
  @ApiProperty({ example: '👍' })
  @IsString()
  @MaxLength(32)
  emoji: string;
}
