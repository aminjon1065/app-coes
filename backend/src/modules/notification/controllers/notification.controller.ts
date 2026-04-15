import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  Body,
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
import { ListNotificationsDto } from '../dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from '../dto/update-notification-preferences.dto';
import { NotificationService } from '../services/notification.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List unread notifications for current user' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('notification.read')
  async list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListNotificationsDto,
  ) {
    return await this.notifications.listUnread(actor, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('notification.read')
  async markRead(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.notifications.markRead(actor, id) };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('notification.read')
  async markAllRead(@CurrentUser() actor: RequestUser) {
    return { data: await this.notifications.markAllRead(actor) };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('notification.read')
  async getPreferences(@CurrentUser() actor: RequestUser) {
    return { data: await this.notifications.getPreferences(actor) };
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('notification.read')
  async updatePreferences(
    @CurrentUser() actor: RequestUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return { data: await this.notifications.updatePreferences(actor, dto) };
  }
}
