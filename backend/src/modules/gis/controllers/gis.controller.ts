import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateFeatureDto } from '../dto/create-feature.dto';
import { CreateLayerDto } from '../dto/create-layer.dto';
import { ListLayersDto } from '../dto/list-layers.dto';
import { NearbyFeaturesDto } from '../dto/nearby-features.dto';
import { UpdateFeatureDto } from '../dto/update-feature.dto';
import { UpdateLayerDto } from '../dto/update-layer.dto';
import { GisService } from '../services/gis.service';

@ApiTags('gis')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('gis')
export class GisController {
  constructor(private readonly gis: GisService) {}

  @Get('layers')
  @ApiOperation({ summary: 'List visible GIS layers' })
  @Roles('duty_operator', 'shift_lead', 'incident_commander', 'field_responder', 'gis_analyst', 'tenant_admin', 'platform_admin', 'auditor')
  async listLayers(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListLayersDto,
  ) {
    return { data: await this.gis.listLayers(actor, query) };
  }

  @Post('layers')
  @ApiOperation({ summary: 'Create GIS layer' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.layer.create')
  async createLayer(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateLayerDto,
  ) {
    return { data: await this.gis.createLayer(actor, dto) };
  }

  @Get('layers/:id')
  @ApiOperation({ summary: 'Get GIS layer metadata' })
  @Roles('duty_operator', 'shift_lead', 'incident_commander', 'field_responder', 'gis_analyst', 'tenant_admin', 'platform_admin', 'auditor')
  async getLayer(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.gis.findLayer(actor, id) };
  }

  @Patch('layers/:id')
  @ApiOperation({ summary: 'Update GIS layer' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.layer.update')
  async updateLayer(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLayerDto,
  ) {
    return { data: await this.gis.updateLayer(actor, id, dto) };
  }

  @Delete('layers/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive GIS layer' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.layer.update')
  async archiveLayer(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.gis.archiveLayer(actor, id);
  }

  @Get('layers/:id/features')
  @ApiOperation({ summary: 'Get layer features as GeoJSON FeatureCollection' })
  @Roles('duty_operator', 'shift_lead', 'incident_commander', 'field_responder', 'gis_analyst', 'tenant_admin', 'platform_admin', 'auditor')
  async getLayerFeatures(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.gis.getLayerFeatures(actor, id) };
  }

  @Post('layers/:id/features')
  @ApiOperation({ summary: 'Create GIS feature' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.feature.create')
  async createFeature(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFeatureDto,
  ) {
    return { data: await this.gis.createFeature(actor, id, dto) };
  }

  @Patch('layers/:id/features/:fid')
  @ApiOperation({ summary: 'Update GIS feature' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.feature.update')
  async updateFeature(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fid', ParseUUIDPipe) fid: string,
    @Body() dto: UpdateFeatureDto,
  ) {
    return { data: await this.gis.updateFeature(actor, id, fid, dto) };
  }

  @Delete('layers/:id/features/:fid')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete GIS feature' })
  @Roles('shift_lead', 'incident_commander', 'gis_analyst', 'tenant_admin', 'platform_admin')
  @Permissions('gis.feature.delete')
  async deleteFeature(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fid', ParseUUIDPipe) fid: string,
  ) {
    await this.gis.deleteFeature(actor, id, fid);
  }

  @Get('incidents/:incidentId/features')
  @ApiOperation({ summary: 'Get all GIS features associated with incident' })
  @Roles('duty_operator', 'shift_lead', 'incident_commander', 'field_responder', 'gis_analyst', 'tenant_admin', 'platform_admin', 'auditor')
  async getIncidentFeatures(
    @CurrentUser() actor: RequestUser,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
  ) {
    return { data: await this.gis.getIncidentFeatures(actor, incidentId) };
  }

  @Get('features/nearby')
  @ApiOperation({ summary: 'Find nearby features by radius in meters' })
  @Roles('duty_operator', 'shift_lead', 'incident_commander', 'field_responder', 'gis_analyst', 'tenant_admin', 'platform_admin', 'auditor')
  async nearbyFeatures(
    @CurrentUser() actor: RequestUser,
    @Query() query: NearbyFeaturesDto,
  ) {
    return { data: await this.gis.nearbyFeatures(actor, query) };
  }
}
