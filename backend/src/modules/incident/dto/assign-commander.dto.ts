import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignCommanderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;
}
