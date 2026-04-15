import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ResolveInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;
}
