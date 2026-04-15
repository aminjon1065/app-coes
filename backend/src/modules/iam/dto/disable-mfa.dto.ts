import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class DisableMfaDto {
  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  @Length(8, 128)
  currentPassword: string;
}
