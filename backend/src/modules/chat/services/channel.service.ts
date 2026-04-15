import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { AddChannelMemberDto } from '../dto/add-channel-member.dto';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';
import { ChannelMember } from '../entities/channel-member.entity';
import { Channel, ChannelType } from '../entities/channel.entity';
import { Message } from '../entities/message.entity';

type ChannelSummary = Channel & {
  memberCount: number;
  unreadCount: number;
  latestMessage: Message | null;
};

type InternalChannelCreate = {
  tenantId: string;
  type: ChannelType;
  createdBy: string;
  incidentId?: string | null;
  name?: string | null;
  description?: string | null;
  memberIds?: string[];
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ChannelService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
  ) {}

  private get channels(): Repository<Channel> {
    return this.databaseContext.getRepository(this.dataSource, Channel);
  }

  private get channelMembers(): Repository<ChannelMember> {
    return this.databaseContext.getRepository(this.dataSource, ChannelMember);
  }

  private get messages(): Repository<Message> {
    return this.databaseContext.getRepository(this.dataSource, Message);
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentParticipant,
    );
  }

  async listForUser(actor: RequestUser): Promise<ChannelSummary[]> {
    const channels = await this.channels
      .createQueryBuilder('channel')
      .innerJoin(ChannelMember, 'member', 'member.channel_id = channel.id')
      .leftJoinAndSelect('channel.incident', 'incident')
      .leftJoinAndSelect('channel.creator', 'creator')
      .where('channel.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('channel.archived_at IS NULL')
      .andWhere('member.user_id = :userId', { userId: actor.id })
      .orderBy('channel.updated_at', 'DESC')
      .getMany();

    return Promise.all(channels.map((channel) => this.enrichChannel(channel, actor.id)));
  }

  async create(actor: RequestUser, dto: CreateChannelDto): Promise<ChannelSummary> {
    return this.createInternal({
      tenantId: actor.tenantId,
      type: dto.type,
      createdBy: actor.id,
      incidentId: dto.incidentId ?? null,
      name: dto.name?.trim() ?? null,
      description: dto.description?.trim() ?? null,
      memberIds: dto.memberIds ?? [],
      metadata: dto.metadata ?? {},
    });
  }

  async createInternal(input: InternalChannelCreate): Promise<ChannelSummary> {
    const memberIds = this.normalizeMembers(input.createdBy, input.memberIds ?? []);
    const memberUsers = await this.loadUsers(input.tenantId, memberIds);

    if (input.type === 'DIRECT' && memberIds.length !== 2) {
      throw new UnprocessableEntityException('DIRECT_CHANNEL_REQUIRES_TWO_MEMBERS');
    }
    if (input.type === 'GROUP' && !input.name?.trim()) {
      throw new UnprocessableEntityException('GROUP_CHANNEL_NAME_REQUIRED');
    }
    if (input.type === 'INCIDENT_ROOM' && !input.incidentId) {
      throw new UnprocessableEntityException('INCIDENT_CHANNEL_REQUIRES_INCIDENT');
    }
    if (input.type === 'INCIDENT_ROOM' && input.incidentId) {
      const existingRoom = await this.channels.findOne({
        where: {
          tenantId: input.tenantId,
          incidentId: input.incidentId,
          type: 'INCIDENT_ROOM',
          archivedAt: IsNull(),
        },
      });
      if (existingRoom) {
        return this.enrichChannel(existingRoom, input.createdBy);
      }
    }

    if (input.incidentId) {
      const incident = await this.incidents.findOne({
        where: { id: input.incidentId, tenantId: input.tenantId },
        select: { id: true },
      });
      if (!incident) {
        throw new NotFoundException('Incident not found');
      }
    }

    if (input.type === 'DIRECT') {
      const existing = await this.findDirectChannel(input.tenantId, memberIds);
      if (existing) {
        return this.enrichChannel(existing, input.createdBy);
      }
    }

    const channel = this.channels.create({
      tenantId: input.tenantId,
      incidentId: input.incidentId ?? null,
      type: input.type,
      name: input.name?.trim() || null,
      description: input.description?.trim() || null,
      createdBy: input.createdBy,
      archivedAt: null,
      metadata: input.metadata ?? {},
    });

    const saved = await this.channels.save(channel);
    await this.channelMembers.save(
      memberUsers.map((user) =>
        this.channelMembers.create({
          channelId: saved.id,
          userId: user.id,
          lastReadAt: user.id === input.createdBy ? new Date() : null,
          isMuted: false,
        }),
      ),
    );

    return this.enrichChannel(saved, input.createdBy);
  }

  async findOne(actor: RequestUser, channelId: string): Promise<ChannelSummary> {
    const channel = await this.getAccessibleChannel(actor, channelId);
    return this.enrichChannel(channel, actor.id);
  }

  async update(
    actor: RequestUser,
    channelId: string,
    dto: UpdateChannelDto,
  ): Promise<ChannelSummary> {
    const channel = await this.getAccessibleChannel(actor, channelId);
    if (!this.canCoordinate(actor, channel)) {
      throw new ForbiddenException('CHANNEL_UPDATE_FORBIDDEN');
    }
    if (channel.type === 'DIRECT' || channel.type === 'INCIDENT_ROOM') {
      throw new UnprocessableEntityException('CHANNEL_UPDATE_FORBIDDEN');
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'name')) {
      channel.name = dto.name?.trim() ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
      channel.description = dto.description?.trim() ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'metadata') && dto.metadata) {
      channel.metadata = dto.metadata;
    }

    await this.channels.save(channel);
    return this.enrichChannel(channel, actor.id);
  }

  async addMember(
    actor: RequestUser,
    channelId: string,
    dto: AddChannelMemberDto,
  ): Promise<ChannelSummary> {
    const channel = await this.getAccessibleChannel(actor, channelId);
    if (!this.canCoordinate(actor, channel)) {
      throw new ForbiddenException('CHANNEL_MEMBER_UPDATE_FORBIDDEN');
    }
    if (channel.type === 'DIRECT') {
      throw new UnprocessableEntityException('DIRECT_CHANNEL_MEMBERSHIP_LOCKED');
    }

    const [user] = await this.loadUsers(actor.tenantId, [dto.userId]);
    const existing = await this.channelMembers.findOne({
      where: { channelId, userId: user.id },
    });
    if (existing) {
      throw new ConflictException('CHANNEL_MEMBER_EXISTS');
    }

    await this.channelMembers.save(
      this.channelMembers.create({
        channelId,
        userId: user.id,
        lastReadAt: null,
        isMuted: dto.muted ?? false,
      }),
    );

    return this.findOne(actor, channelId);
  }

  async removeMember(
    actor: RequestUser,
    channelId: string,
    userId: string,
  ): Promise<void> {
    const channel = await this.getAccessibleChannel(actor, channelId);
    if (!this.canCoordinate(actor, channel) && actor.id !== userId) {
      throw new ForbiddenException('CHANNEL_MEMBER_UPDATE_FORBIDDEN');
    }

    const member = await this.channelMembers.findOne({ where: { channelId, userId } });
    if (!member) {
      throw new NotFoundException('Channel member not found');
    }
    if (channel.type === 'DIRECT') {
      throw new UnprocessableEntityException('DIRECT_CHANNEL_MEMBERSHIP_LOCKED');
    }

    await this.channelMembers.remove(member);
  }

  async archive(actor: RequestUser, channelId: string): Promise<void> {
    const channel = await this.getAccessibleChannel(actor, channelId);
    if (!this.canCoordinate(actor, channel)) {
      throw new ForbiddenException('CHANNEL_ARCHIVE_FORBIDDEN');
    }

    channel.archivedAt = new Date();
    await this.channels.save(channel);
  }

  async ensureMember(actor: RequestUser, channelId: string): Promise<Channel> {
    return this.getAccessibleChannel(actor, channelId);
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    const member = await this.channelMembers.findOne({ where: { channelId, userId } });
    return Boolean(member);
  }

  async getMembershipChannelIds(userId: string, tenantId: string): Promise<string[]> {
    const rows = await this.channelMembers
      .createQueryBuilder('member')
      .innerJoin(Channel, 'channel', 'channel.id = member.channel_id')
      .where('member.user_id = :userId', { userId })
      .andWhere('channel.tenant_id = :tenantId', { tenantId })
      .andWhere('channel.archived_at IS NULL')
      .select('member.channel_id', 'channelId')
      .getRawMany<{ channelId: string }>();

    return rows.map((row) => row.channelId);
  }

  async syncIncidentParticipants(
    tenantId: string,
    incidentId: string,
    actorId: string,
  ): Promise<ChannelSummary | null> {
    const room = await this.channels.findOne({
      where: {
        tenantId,
        incidentId,
        type: 'INCIDENT_ROOM',
        archivedAt: IsNull(),
      },
    });
    if (!room) {
      return null;
    }

    const participants = await this.participants.find({
      where: { incidentId, leftAt: null as never },
      select: { userId: true },
    });
    const desiredMembers = this.normalizeMembers(
      actorId,
      participants.map((item) => item.userId),
    );
    const currentMembers = await this.channelMembers.find({
      where: { channelId: room.id },
      select: { channelId: true, userId: true },
    });

    const currentSet = new Set(currentMembers.map((item) => item.userId));
    const desiredSet = new Set(desiredMembers);

    const toAdd = desiredMembers.filter((userId) => !currentSet.has(userId));
    if (toAdd.length) {
      await this.loadUsers(tenantId, toAdd);
      await this.channelMembers.save(
        toAdd.map((userId) =>
          this.channelMembers.create({
            channelId: room.id,
            userId,
            lastReadAt: null,
            isMuted: false,
          }),
        ),
      );
    }

    const toRemove = currentMembers.filter((item) => !desiredSet.has(item.userId));
    if (toRemove.length) {
      await this.channelMembers.remove(toRemove);
    }

    return this.enrichChannel(room, actorId);
  }

  private async getAccessibleChannel(
    actor: RequestUser,
    channelId: string,
  ): Promise<Channel> {
    const channel = await this.channels
      .createQueryBuilder('channel')
      .innerJoin(ChannelMember, 'member', 'member.channel_id = channel.id')
      .leftJoinAndSelect('channel.incident', 'incident')
      .leftJoinAndSelect('channel.creator', 'creator')
      .where('channel.id = :channelId', { channelId })
      .andWhere('channel.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('channel.archived_at IS NULL')
      .andWhere('member.user_id = :userId', { userId: actor.id })
      .getOne();

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  private async enrichChannel(
    channel: Channel,
    viewerId: string,
  ): Promise<ChannelSummary> {
    const memberCount = await this.channelMembers.count({
      where: { channelId: channel.id },
    });
    const membership = await this.channelMembers.findOne({
      where: { channelId: channel.id, userId: viewerId },
    });
    const unreadCount = await this.messages
      .createQueryBuilder('message')
      .where('message.channel_id = :channelId', { channelId: channel.id })
      .andWhere('message.created_at > :lastReadAt', {
        lastReadAt: membership?.lastReadAt ?? new Date(0),
      })
      .getCount();
    const latestMessage = await this.messages.findOne({
      where: { channelId: channel.id },
      order: { createdAt: 'DESC' },
      relations: ['sender'],
    });

    return Object.assign(channel, {
      memberCount,
      unreadCount,
      latestMessage: latestMessage ?? null,
    });
  }

  private async loadUsers(tenantId: string, userIds: string[]): Promise<User[]> {
    const uniqueIds = [...new Set(userIds)];
    const users = await this.users.find({
      where: { id: In(uniqueIds), tenantId, status: 'active' },
    });
    if (users.length !== uniqueIds.length) {
      throw new UnprocessableEntityException('CHANNEL_MEMBER_NOT_FOUND');
    }
    return users;
  }

  private normalizeMembers(createdBy: string, memberIds: string[]): string[] {
    return [...new Set([createdBy, ...memberIds])];
  }

  private async findDirectChannel(
    tenantId: string,
    memberIds: string[],
  ): Promise<Channel | null> {
    if (memberIds.length !== 2) {
      return null;
    }

    const channels = await this.channels.find({
      where: { tenantId, type: 'DIRECT', archivedAt: IsNull() },
    });

    const targetIds = memberIds.slice().sort();
    for (const channel of channels) {
      const members = await this.channelMembers.find({
        where: { channelId: channel.id },
        select: { userId: true },
      });
      const ids = members.map((item) => item.userId).sort();
      if (ids.length === 2 && ids[0] === targetIds[0] && ids[1] === targetIds[1]) {
        return channel;
      }
    }

    return null;
  }

  private canCoordinate(actor: RequestUser, channel: Channel): boolean {
    if (
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin')
    ) {
      return true;
    }
    if (channel.createdBy === actor.id) {
      return true;
    }
    return (
      Boolean(channel.incidentId) &&
      (actor.roles.includes('shift_lead') || actor.roles.includes('incident_commander'))
    );
  }
}
