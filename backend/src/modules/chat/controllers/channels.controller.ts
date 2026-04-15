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
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { AddChannelMemberDto } from '../dto/add-channel-member.dto';
import { AddReactionDto } from '../dto/add-reaction.dto';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { ListChannelMessagesDto } from '../dto/list-channel-messages.dto';
import { RedactMessageDto } from '../dto/redact-message.dto';
import { SendMessageDto } from '../dto/send-message.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';
import { ChannelService } from '../services/channel.service';
import { MessageService } from '../services/message.service';

@ApiTags('chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelService,
    private readonly messages: MessageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List channels accessible to the current user' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
    'auditor',
  )
  async list(@CurrentUser() actor: RequestUser) {
    return { data: await this.channels.listForUser(actor) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a direct or group chat channel' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  async create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateChannelDto,
  ) {
    return { data: await this.channels.create(actor, dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel metadata' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
    'auditor',
  )
  async getOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.channels.findOne(actor, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update channel metadata' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  async update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return { data: await this.channels.update(actor, id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive a channel' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  async archive(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.channels.archive(actor, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get channel message history' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
    'auditor',
  )
  async listMessages(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListChannelMessagesDto,
  ) {
    return await this.messages.list(actor, id, query);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a chat message' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  async sendMessage(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return { data: await this.messages.send(actor, id, dto) };
  }

  @Patch(':id/messages/:msgId/redact')
  @ApiOperation({ summary: 'Redact a chat message' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  async redactMessage(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('msgId', ParseUUIDPipe) msgId: string,
    @Body() dto: RedactMessageDto,
  ) {
    return { data: await this.messages.redact(actor, id, msgId, dto) };
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add member to channel' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  async addMember(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddChannelMemberDto,
  ) {
    return { data: await this.channels.addMember(actor, id, dto) };
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove member from channel' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'tenant_admin',
    'platform_admin',
  )
  async removeMember(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.channels.removeMember(actor, id, userId);
    return { data: { success: true } };
  }

  @Post(':id/reactions/:msgId')
  @ApiOperation({ summary: 'Add message reaction' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  async addReaction(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('msgId', ParseUUIDPipe) msgId: string,
    @Body() dto: AddReactionDto,
  ) {
    return { data: await this.messages.addReaction(actor, id, msgId, dto) };
  }

  @Delete(':id/reactions/:msgId/:emoji')
  @ApiOperation({ summary: 'Remove message reaction' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'agency_liaison',
    'tenant_admin',
    'platform_admin',
  )
  async removeReaction(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('msgId', ParseUUIDPipe) msgId: string,
    @Param('emoji') emoji: string,
  ) {
    return {
      data: await this.messages.removeReaction(actor, id, msgId, emoji),
    };
  }
}
