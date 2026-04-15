import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class AnalyticsRangeDto {
  @ApiPropertyOptional({ example: '2026-04-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-04-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;
}

export class IncidentVolumeDto extends AnalyticsRangeDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: 'day' | 'week' | 'month';
}

export class TaskThroughputDto extends AnalyticsRangeDto {
  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  incidentId?: string;
}

export class AnalyticsExportDto extends AnalyticsRangeDto {
  @ApiPropertyOptional({ enum: ['csv'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';

  @ApiPropertyOptional({ enum: ['incidents', 'tasks'], default: 'incidents' })
  @IsOptional()
  @IsIn(['incidents', 'tasks'])
  type?: 'incidents' | 'tasks';
}
