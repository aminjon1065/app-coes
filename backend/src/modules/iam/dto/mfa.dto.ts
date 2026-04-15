import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class MfaVerifyDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class MfaEnrollResponseDto {
  @ApiProperty()
  secret: string;

  @ApiProperty()
  uri: string;

  @ApiProperty({ description: 'QR code as data:image/png;base64,...' })
  qrCodeDataUrl: string;
}
