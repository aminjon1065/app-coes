import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class JoinCallDto {
  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  @IsUUID('4')
  callId: string;
}
