import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { AddParticipantDto } from '../dto/add-participant.dto';
import { AssignCommanderDto } from '../dto/assign-commander.dto';
import { ChangeSeverityDto } from '../dto/change-severity.dto';
import { CreateIncidentDto } from '../dto/create-incident.dto';
import { ListIncidentsDto } from '../dto/list-incidents.dto';
import { ListSitrepsDto } from '../dto/list-sitreps.dto';
import { ListTimelineDto } from '../dto/list-timeline.dto';
import { SubmitSitrepDto } from '../dto/submit-sitrep.dto';
import { TransitionStatusDto } from '../dto/transition-status.dto';
import { IncidentsService } from '../services/incidents.service';
import { RealtimeEventsService } from '../../../shared/events/realtime-events.service';

@ApiTags('incidents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new incident draft' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.create')
  async create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateIncidentDto,
  ) {
    return { data: await this.incidents.create(actor, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List incidents visible to the current user' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async findAll(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListIncidentsDto,
  ) {
    return { data: await this.incidents.findAll(actor, query) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an incident by ID' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.incidents.findOne(actor, id) };
  }

  @Post(':id/transitions')
  @ApiOperation({ summary: 'Execute an incident status transition' })
  @Roles('shift_lead', 'incident_commander', 'tenant_admin', 'platform_admin')
  @Permissions('incident.update.status')
  async transition(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionStatusDto,
  ) {
    return { data: await this.incidents.transition(actor, id, dto) };
  }

  @Post(':id/severity')
  @ApiOperation({ summary: 'Change incident severity' })
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('incident.update.severity')
  async changeSeverity(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSeverityDto,
  ) {
    return { data: await this.incidents.changeSeverity(actor, id, dto) };
  }

  @Post(':id/commander')
  @ApiOperation({ summary: 'Assign incident commander' })
  @Roles('shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('incident.assign.commander')
  async assignCommander(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCommanderDto,
  ) {
    return {
      data: await this.incidents.assignCommander(actor, id, dto.userId),
    };
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'List active incident participants' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async listParticipants(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.incidents.listParticipants(actor, id) };
  }

  @Post(':id/participants')
  @ApiOperation({ summary: 'Add incident participant' })
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('incident.update.participants')
  async addParticipant(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ) {
    return {
      data: await this.incidents.addParticipant(
        actor,
        id,
        dto.userId,
        dto.role,
      ),
    };
  }

  @Delete(':id/participants/:userId')
  @ApiOperation({ summary: 'Remove incident participant' })
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('incident.update.participants')
  async removeParticipant(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.incidents.removeParticipant(actor, id, userId);
    return { data: { success: true } };
  }

  @Get(':id/sitreps')
  @ApiOperation({ summary: 'List incident situation reports' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async listSitreps(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSitrepsDto,
  ) {
    return await this.incidents.listSitreps(actor, id, query);
  }

  @Post(':id/sitreps')
  @ApiOperation({ summary: 'Submit incident situation report' })
  @Roles(
    'field_responder',
    'incident_commander',
    'shift_lead',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.sitrep.create')
  async submitSitrep(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitSitrepDto,
  ) {
    return { data: await this.incidents.submitSitrep(actor, id, dto) };
  }

  @Get(':id/transitions/available')
  @ApiOperation({
    summary: 'List transitions currently available to the caller',
  })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async availableTransitions(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.incidents.getAvailableTransitions(actor, id) };
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get incident timeline entries' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async timeline(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTimelineDto,
  ) {
    return this.incidents.getTimeline(actor, id, query);
  }

  @Sse(':id/stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: 'Stream incident activity updates via SSE' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('incident.read')
  async stream(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.incidents.findOne(actor, id);

    return this.realtimeEvents.stream({
      tenantId: actor.tenantId,
      incidentId: id,
    });
  }
}
