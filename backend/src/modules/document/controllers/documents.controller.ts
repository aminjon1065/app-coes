import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { CreateDocumentDto } from '../dto/create-document.dto';
import { DocumentApprovalActionDto } from '../dto/document-approval-action.dto';
import { ListDocumentsDto } from '../dto/list-documents.dto';
import { DocumentService } from '../services/document.service';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Post()
  @ApiOperation({ summary: 'Create document from template' })
  @Roles('incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.create')
  async create(@CurrentUser() actor: RequestUser, @Body() dto: CreateDocumentDto) {
    return { data: await this.documents.create(actor, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List visible documents' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin', 'agency_liaison', 'analyst', 'auditor')
  @Permissions('document.read')
  async list(@CurrentUser() actor: RequestUser, @Query() query: ListDocumentsDto) {
    return { data: await this.documents.list(actor, query) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document detail' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin', 'agency_liaison', 'analyst', 'auditor')
  @Permissions('document.read')
  async getOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.documents.findOne(actor, id) };
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List document versions' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin', 'agency_liaison', 'analyst', 'auditor')
  @Permissions('document.read')
  async versions(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.documents.listVersions(actor, id) };
  }

  @Get(':id/versions/:vid/url')
  @ApiOperation({ summary: 'Get presigned URL for document version' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin', 'agency_liaison', 'analyst', 'auditor')
  @Permissions('document.read')
  async versionUrl(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('vid', ParseUUIDPipe) vid: string,
  ) {
    return { data: { url: await this.documents.getVersionUrl(actor, id, vid) } };
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: 'Submit document for review' })
  @Roles('incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.create')
  async submitReview(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.documents.submitReview(actor, id) };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve document review cycle' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.approve.level1')
  async approve(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentApprovalActionDto,
  ) {
    return { data: await this.documents.approve(actor, id, dto.comment) };
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject document review cycle' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.approve.level1')
  async reject(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentApprovalActionDto,
  ) {
    return { data: await this.documents.reject(actor, id, dto.comment) };
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish approved document' })
  @Roles('incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.approve.level2')
  async publish(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.documents.publish(actor, id) };
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke document and write tombstone version' })
  @Roles('incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('document.approve.level2')
  async revoke(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentApprovalActionDto,
  ) {
    return { data: await this.documents.revoke(actor, id, dto.comment) };
  }
}
