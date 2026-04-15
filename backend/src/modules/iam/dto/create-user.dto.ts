import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsOptional,
  Length,
  Min,
  Max,
  IsInt,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'operator@coescd.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Rustam Nazarov' })
  @IsString()
  @Length(2, 255)
  fullName: string;

  @ApiProperty({ required: false, example: '+992900000000' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: 'Admin123!',
    description: 'Min 8 chars, at least 1 upper, 1 number',
  })
  @IsString()
  @Length(8, 128)
  password: string;

  @ApiProperty({ required: false, example: 1, minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  @IsOptional()
  clearance?: number;
}
