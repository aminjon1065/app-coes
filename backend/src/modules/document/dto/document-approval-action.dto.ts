import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DocumentApprovalActionDto {
  @ApiPropertyOptional({ example: 'Reviewed and approved for publication.' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  comment?: string;
}
