import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type RequestUser,
} from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { CreateTenantInvitationDto } from '../dto/create-tenant-invitation.dto';
import { TenantInvitationService } from '../services/tenant-invitation.service';

@ApiTags('tenants')
@Controller('tenants')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth('access-token')
export class TenantsController {
  constructor(private readonly invitations: TenantInvitationService) {}

  @Post(':id/invite')
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @ApiOperation({
    summary: 'Invite an inter-agency liaison into tenant incident scope',
  })
  async invite(
    @CurrentUser() actor: RequestUser,
    @Param('id') tenantId: string,
    @Body() dto: CreateTenantInvitationDto,
  ) {
    return {
      data: await this.invitations.create(actor, tenantId, dto),
    };
  }
}
