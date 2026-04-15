import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({ example: 'Initial Flood Impact Report' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'initial-report' })
  @IsString()
  @MaxLength(100)
  templateCode: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  incidentId?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  classification?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  templateVars?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
