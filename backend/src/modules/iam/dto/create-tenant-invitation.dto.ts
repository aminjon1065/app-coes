import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateTenantInvitationDto {
  @ApiProperty({ example: 'liaison@agency.local' })
  @IsEmail()
  email: string;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['3e9c0180-49f8-4b61-a07b-bdfd3f4a2fb5'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(24)
  @IsOptional()
  incidentScope?: string[];
}
