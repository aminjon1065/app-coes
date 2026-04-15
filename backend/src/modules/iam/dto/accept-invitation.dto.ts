import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ example: 'liaison@agency.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Agency Liaison' })
  @IsString()
  @Length(2, 255)
  fullName: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @Length(8, 128)
  password: string;

  @ApiProperty({ required: false, example: '+992900000009' })
  @IsOptional()
  @IsString()
  @Length(0, 32)
  phone?: string;
}
