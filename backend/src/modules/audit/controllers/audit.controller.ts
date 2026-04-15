import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
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
import { ExportAuditDto } from '../dto/export-audit.dto';
import { ListAuditEventsDto } from '../dto/list-audit-events.dto';
import { AuditService } from '../services/audit.service';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit events' })
  @Roles('auditor', 'platform_admin')
  @Permissions('audit.read')
  async list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListAuditEventsDto,
  ) {
    return await this.audit.list(actor, query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export audit events as CSV' })
  @Roles('auditor', 'platform_admin')
  @Permissions('audit.read')
  async export(
    @CurrentUser() actor: RequestUser,
    @Query() format: ExportAuditDto,
    @Query() query: ListAuditEventsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.audit.exportCsv(actor, query);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-export.${format.format ?? 'csv'}"`,
    );
    return csv;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audit event by ID' })
  @Roles('auditor', 'platform_admin')
  @Permissions('audit.read')
  async getOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.audit.findOne(actor, id) };
  }
}
