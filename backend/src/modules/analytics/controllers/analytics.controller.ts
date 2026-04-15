import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import {
  AnalyticsExportDto,
  AnalyticsRangeDto,
  IncidentVolumeDto,
  TaskThroughputDto,
} from '../dto/analytics-range.dto';
import { AnalyticsService } from '../services/analytics.service';

@ApiTags('analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Analytics KPI summary' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.read')
  async summary(@CurrentUser() actor: RequestUser, @Query() query: AnalyticsRangeDto) {
    return { data: await this.analytics.summary(actor, query) };
  }

  @Get('incident-volume')
  @ApiOperation({ summary: 'Incident volume time series' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.read')
  async incidentVolume(
    @CurrentUser() actor: RequestUser,
    @Query() query: IncidentVolumeDto,
  ) {
    return { data: await this.analytics.incidentVolume(actor, query) };
  }

  @Get('task-throughput')
  @ApiOperation({ summary: 'Task throughput by final status' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.read')
  async taskThroughput(
    @CurrentUser() actor: RequestUser,
    @Query() query: TaskThroughputDto,
  ) {
    return { data: await this.analytics.taskThroughput(actor, query) };
  }

  @Get('sla-compliance')
  @ApiOperation({ summary: 'SLA compliance rate' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.read')
  async slaCompliance(
    @CurrentUser() actor: RequestUser,
    @Query() query: AnalyticsRangeDto,
  ) {
    return { data: await this.analytics.slaCompliance(actor, query) };
  }

  @Get('by-category')
  @ApiOperation({ summary: 'Incident counts by category' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.read')
  async byCategory(
    @CurrentUser() actor: RequestUser,
    @Query() query: AnalyticsRangeDto,
  ) {
    return { data: await this.analytics.byCategory(actor, query) };
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export analytics CSV' })
  @Roles('analyst', 'platform_admin')
  @Permissions('analytics.export')
  async export(
    @CurrentUser() actor: RequestUser,
    @Query() query: AnalyticsExportDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.analytics.exportCsv(actor, query);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics-${query.type ?? 'incidents'}.csv"`,
    );
    return csv;
  }
}
