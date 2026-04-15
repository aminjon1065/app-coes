import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { DOCUMENT_LIFECYCLE_STATES } from '../entities/document.entity';

export class ListDocumentsDto {
  @ApiPropertyOptional({ enum: DOCUMENT_LIFECYCLE_STATES })
  @IsOptional()
  @IsIn(DOCUMENT_LIFECYCLE_STATES)
  state?: (typeof DOCUMENT_LIFECYCLE_STATES)[number];

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  incidentId?: string;

  @ApiPropertyOptional({ example: 'initial-report' })
  @IsOptional()
  @IsString()
  templateCode?: string;
}
