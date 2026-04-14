import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AddTaskCommentDto {
  @ApiProperty({ example: 'Water tankers arrived at the site and are being set up.' })
  @IsString()
  @Length(1, 5000)
  body: string;
}
