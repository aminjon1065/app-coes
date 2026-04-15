import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MESSAGE_KINDS } from '../entities/message.entity';

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Unit Bravo reached checkpoint 3.' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  content?: string;

  @ApiPropertyOptional({ enum: MESSAGE_KINDS, example: 'TEXT' })
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: (typeof MESSAGE_KINDS)[number];

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  fileId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
