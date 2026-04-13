import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, IsOptional } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@coescd.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  @Length(8, 128)
  password: string;

  /** TOTP code — required when user has mfa_enabled = true */
  @ApiProperty({ required: false, example: '123456' })
  @IsString()
  @IsOptional()
  @Length(6, 6)
  totpCode?: string;
}
