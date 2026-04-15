import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { FileEntity } from '../../file/entities/file.entity';
import { ChannelService } from './channel.service';
import { ChatGateway } from '../gateways/chat.gateway';
import { AddReactionDto } from '../dto/add-reaction.dto';
import { ListChannelMessagesDto } from '../dto/list-channel-messages.dto';
import { RedactMessageDto } from '../dto/redact-message.dto';
import { SendMessageDto } from '../dto/send-message.dto';
import { ChannelMember } from '../entities/channel-member.entity';
import { MessageReaction } from '../entities/message-reaction.entity';
import { Message } from '../entities/message.entity';

type MessageWithRelations = Message & {
  reactions: MessageReaction[];
};

@Injectable()
export class MessageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly channelService: ChannelService,
    private readonly events: EventEmitter2,
    private readonly chatGateway: ChatGateway,
  ) {}

  private get messages(): Repository<Message> {
    return this.databaseContext.getRepository(this.dataSource, Message);
  }

  private get reactions(): Repository<MessageReaction> {
    return this.databaseContext.getRepository(this.dataSource, MessageReaction);
  }

  private get memberships(): Repository<ChannelMember> {
    return this.databaseContext.getRepository(this.dataSource, ChannelMember);
  }

  private get files(): Repository<FileEntity> {
    return this.databaseContext.getRepository(this.dataSource, FileEntity);
  }

  async list(
    actor: RequestUser,
    channelId: string,
    query: ListChannelMessagesDto,
  ): Promise<{ data: MessageWithRelations[]; page: { nextCursor: string | null; limit: number } }> {
    await this.channelService.ensureMember(actor, channelId);

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const qb = this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.redactor', 'redactor')
      .where('message.channel_id = :channelId', { channelId })
      .orderBy('message.created_at', 'DESC')
      .take(limit + 1);

    if (query.before) {
      const cursor = await this.messages.findOne({
        where: { id: query.before, channelId },
        select: { createdAt: true },
      });
      if (!cursor) {
        throw new NotFoundException('Message cursor not found');
      }
      qb.andWhere('message.created_at < :cursorCreatedAt', {
        cursorCreatedAt: cursor.createdAt,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const data = await Promise.all(pageRows.map((message) => this.hydrateMessage(message)));

    await this.markRead(channelId, actor.id);

    return {
      data,
      page: {
        nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
        limit,
      },
    };
  }

  async send(
    actor: RequestUser,
    channelId: string,
    dto: SendMessageDto,
  ): Promise<MessageWithRelations> {
    const channel = await this.channelService.ensureMember(actor, channelId);
    const kind = dto.kind ?? (dto.fileId ? 'FILE' : 'TEXT');
    const content = dto.content?.trim() ?? null;

    if (!content && !dto.fileId) {
      throw new UnprocessableEntityException('MESSAGE_CONTENT_REQUIRED');
    }
    if (kind === 'FILE' && !dto.fileId) {
      throw new UnprocessableEntityException('MESSAGE_FILE_REQUIRED');
    }

    if (dto.fileId) {
      const file = await this.files.findOne({
        where: { id: dto.fileId, tenantId: actor.tenantId, deletedAt: null as never },
        select: { id: true, scanStatus: true },
      });
      if (!file || file.scanStatus !== 'CLEAN') {
        throw new UnprocessableEntityException('MESSAGE_FILE_NOT_AVAILABLE');
      }
    }

    if (dto.parentId) {
      const parent = await this.messages.findOne({
        where: { id: dto.parentId, channelId },
        select: { id: true },
      });
      if (!parent) {
        throw new UnprocessableEntityException('MESSAGE_PARENT_NOT_FOUND');
      }
    }

    const message = await this.messages.save(
      this.messages.create({
        channelId: channel.id,
        senderId: actor.id,
        content,
        kind,
        parentId: dto.parentId ?? null,
        fileId: dto.fileId ?? null,
        redactedAt: null,
        redactedBy: null,
        redactReason: null,
        metadata: dto.metadata ?? {},
      }),
    );

    await this.markRead(channel.id, actor.id);
    const hydrated = await this.hydrateMessage(message);

    this.chatGateway.emitMessageNew(hydrated);
    this.events.emit('chat.message.sent', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      channelId: channel.id,
      messageId: hydrated.id,
      incidentId: channel.incidentId,
    });

    return hydrated;
  }

  async redact(
    actor: RequestUser,
    channelId: string,
    messageId: string,
    dto: RedactMessageDto,
  ): Promise<MessageWithRelations> {
    await this.channelService.ensureMember(actor, channelId);
    const message = await this.messages.findOne({ where: { id: messageId, channelId } });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.redactedAt) {
      return this.hydrateMessage(message);
    }
    if (
      message.senderId !== actor.id &&
      !actor.roles.includes('platform_admin') &&
      !actor.roles.includes('tenant_admin') &&
      !actor.roles.includes('shift_lead')
    ) {
      throw new ForbiddenException('MESSAGE_REDACT_FORBIDDEN');
    }

    message.redactedAt = new Date();
    message.redactedBy = actor.id;
    message.redactReason = dto.reason.trim();
    message.content = null;
    await this.messages.save(message);

    const hydrated = await this.hydrateMessage(message);
    this.chatGateway.emitMessageRedacted(hydrated);
    this.events.emit('chat.message.redacted', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      channelId,
      messageId,
      reason: dto.reason.trim(),
    });

    return hydrated;
  }

  async addReaction(
    actor: RequestUser,
    channelId: string,
    messageId: string,
    dto: AddReactionDto,
  ): Promise<MessageWithRelations> {
    await this.channelService.ensureMember(actor, channelId);
    const message = await this.messages.findOne({ where: { id: messageId, channelId } });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const emoji = dto.emoji.trim();
    const existing = await this.reactions.findOne({
      where: { messageId, userId: actor.id, emoji },
    });
    if (existing) {
      throw new ConflictException('MESSAGE_REACTION_EXISTS');
    }

    await this.reactions.save(
      this.reactions.create({
        messageId,
        userId: actor.id,
        emoji,
      }),
    );

    const hydrated = await this.hydrateMessage(message);
    this.chatGateway.emitReactionChanged(channelId, messageId, hydrated.reactions);
    return hydrated;
  }

  async removeReaction(
    actor: RequestUser,
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<MessageWithRelations> {
    await this.channelService.ensureMember(actor, channelId);
    const message = await this.messages.findOne({ where: { id: messageId, channelId } });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const reaction = await this.reactions.findOne({
      where: { messageId, userId: actor.id, emoji },
    });
    if (!reaction) {
      throw new NotFoundException('Message reaction not found');
    }

    await this.reactions.remove(reaction);
    const hydrated = await this.hydrateMessage(message);
    this.chatGateway.emitReactionChanged(channelId, messageId, hydrated.reactions);
    return hydrated;
  }

  private async hydrateMessage(message: Message): Promise<MessageWithRelations> {
    const hydrated = await this.messages.findOne({
      where: { id: message.id },
      relations: ['sender', 'redactor'],
    });
    if (!hydrated) {
      throw new NotFoundException('Message not found');
    }

    const reactions = await this.reactions.find({
      where: { messageId: message.id },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    return Object.assign(hydrated, { reactions });
  }

  private async markRead(channelId: string, userId: string): Promise<void> {
    await this.memberships.update(
      { channelId, userId },
      { lastReadAt: new Date() },
    );
  }
}
