import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { Task } from '../../task/entities/task.entity';
import { ListNotificationsDto } from '../dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from '../dto/update-notification-preferences.dto';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { EmailService } from './email.service';
import { InAppService } from './in-app.service';

type NotificationPayload = {
  tenantId: string;
  actorId?: string | null;
  eventType: string;
  title: string;
  body: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
  recipientIds: string[];
  severity?: string | number | null;
};

@Injectable()
export class NotificationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly inApp: InAppService,
    private readonly email: EmailService,
  ) {}

  private get notifications(): Repository<NotificationEntity> {
    return this.databaseContext.getRepository(
      this.dataSource,
      NotificationEntity,
    );
  }

  private get preferences(): Repository<NotificationPreference> {
    return this.databaseContext.getRepository(
      this.dataSource,
      NotificationPreference,
    );
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

  private get tasks(): Repository<Task> {
    return this.databaseContext.getRepository(this.dataSource, Task);
  }

  async listUnread(
    actor: RequestUser,
    query: ListNotificationsDto,
  ): Promise<{
    data: NotificationEntity[];
    page: { nextCursor: string | null; limit: number; hasMore: boolean };
  }> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const qb = this.notifications
      .createQueryBuilder('notification')
      .where('notification.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('notification.user_id = :userId', { userId: actor.id })
      .andWhere('notification.read_at IS NULL')
      .orderBy('notification.created_at', 'DESC')
      .take(limit + 1);

    if (query.cursor) {
      const cursor = await this.notifications.findOne({
        where: { id: query.cursor, tenantId: actor.tenantId, userId: actor.id },
        select: { createdAt: true },
      });
      if (!cursor) {
        throw new NotFoundException('Notification cursor not found');
      }
      qb.andWhere('notification.created_at < :cursorCreatedAt', {
        cursorCreatedAt: cursor.createdAt,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return {
      data,
      page: {
        nextCursor: hasMore ? data.at(-1)?.id ?? null : null,
        limit,
        hasMore,
      },
    };
  }

  async markRead(actor: RequestUser, id: string): Promise<NotificationEntity> {
    const notification = await this.notifications.findOne({
      where: { id, tenantId: actor.tenantId, userId: actor.id },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return notification;
  }

  async markAllRead(actor: RequestUser): Promise<{ updated: number }> {
    const result = await this.notifications
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ readAt: new Date() })
      .where('tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('user_id = :userId', { userId: actor.id })
      .andWhere('read_at IS NULL')
      .execute();

    return { updated: result.affected ?? 0 };
  }

  async getPreferences(actor: RequestUser): Promise<NotificationPreference> {
    return this.ensurePreferences(actor.id, actor.tenantId);
  }

  async updatePreferences(
    actor: RequestUser,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreference> {
    const preference = await this.ensurePreferences(actor.id, actor.tenantId);

    if (Object.prototype.hasOwnProperty.call(dto, 'isDisabled')) {
      preference.isDisabled = dto.isDisabled ?? preference.isDisabled;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'emailEnabled')) {
      preference.emailEnabled = dto.emailEnabled ?? preference.emailEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'pushEnabled')) {
      preference.pushEnabled = dto.pushEnabled ?? preference.pushEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'inAppEnabled')) {
      preference.inAppEnabled = dto.inAppEnabled ?? preference.inAppEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'eventOverrides') && dto.eventOverrides) {
      preference.eventOverrides = dto.eventOverrides;
    }

    return this.preferences.save(preference);
  }

  async dispatch(input: NotificationPayload): Promise<NotificationEntity[]> {
    const critical = this.isCritical(input.severity);
    const dedupedRecipients = [...new Set(input.recipientIds)].filter(Boolean);
    if (!dedupedRecipients.length) {
      return [];
    }

    const activeUsers = await this.users.find({
      where: {
        id: In(dedupedRecipients),
        tenantId: input.tenantId,
        status: 'active',
        deletedAt: IsNull(),
      },
      select: { id: true, tenantId: true },
    });
    const activeUserIds = new Set(activeUsers.map((user) => user.id));

    const delivered: NotificationEntity[] = [];
    for (const recipientId of dedupedRecipients) {
      if (!activeUserIds.has(recipientId)) {
        continue;
      }

      const eventId =
        String(input.metadata?.eventId ?? this.buildEventId(input, recipientId));
      const duplicate = await this.notifications
        .createQueryBuilder('notification')
        .where('notification.tenant_id = :tenantId', { tenantId: input.tenantId })
        .andWhere('notification.user_id = :userId', { userId: recipientId })
        .andWhere('notification.event_type = :eventType', {
          eventType: input.eventType,
        })
        .andWhere(`notification.metadata ->> 'eventId' = :eventId`, { eventId })
        .getExists();
      if (duplicate) {
        continue;
      }

      const preference = await this.ensurePreferences(recipientId, input.tenantId);
      if (!critical && preference.isDisabled) {
        continue;
      }

      const overrides = preference.eventOverrides[input.eventType] ?? {};
      const inAppEnabled = critical ? true : overrides.inApp ?? preference.inAppEnabled;
      const emailEnabled = critical ? true : overrides.email ?? preference.emailEnabled;

      const notification = await this.notifications.save(
        this.notifications.create({
          tenantId: input.tenantId,
          userId: recipientId,
          eventType: input.eventType,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
          readAt: null,
          metadata: {
            ...(input.metadata ?? {}),
            eventId,
            critical,
          },
        }),
      );

      if (inAppEnabled) {
        await this.inApp.deliver(notification);
      }
      if (emailEnabled) {
        await this.email.queue(notification);
      }

      delivered.push(notification);
    }

    return delivered;
  }

  async resolveIncidentRecipients(
    tenantId: string,
    incidentId: string,
    actorId?: string | null,
  ): Promise<string[]> {
    const incident = await this.incidents.findOne({
      where: { id: incidentId, tenantId },
      select: { commanderId: true, createdBy: true },
    });
    if (!incident) {
      return [];
    }

    const participants = await this.participants.find({
      where: { incidentId, leftAt: null as never },
      select: { userId: true },
    });

    return [...new Set([
      incident.commanderId,
      incident.createdBy,
      ...participants.map((item) => item.userId),
    ])].filter((userId): userId is string => Boolean(userId) && userId !== actorId);
  }

  async resolveTaskAssignee(
    tenantId: string,
    taskId: string,
    fallbackAssigneeId?: string | null,
  ): Promise<string[]> {
    if (fallbackAssigneeId) {
      return [fallbackAssigneeId];
    }

    const task = await this.tasks.findOne({
      where: { id: taskId, tenantId, deletedAt: IsNull() },
      select: { assigneeId: true },
    });
    return task?.assigneeId ? [task.assigneeId] : [];
  }

  private async ensurePreferences(
    userId: string,
    tenantId: string,
  ): Promise<NotificationPreference> {
    const existing = await this.preferences.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }

    return this.preferences.save(
      this.preferences.create({
        userId,
        tenantId,
        isDisabled: false,
        emailEnabled: true,
        pushEnabled: false,
        inAppEnabled: true,
        eventOverrides: {},
      }),
    );
  }

  private isCritical(severity?: string | number | null): boolean {
    if (typeof severity === 'string') {
      if (severity.toUpperCase() === 'CRITICAL') {
        return true;
      }
      const numeric = Number(severity);
      return Number.isFinite(numeric) && numeric >= 4;
    }
    return typeof severity === 'number' && severity >= 4;
  }

  private buildEventId(
    input: NotificationPayload,
    recipientId: string,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: input.tenantId,
          recipientId,
          eventType: input.eventType,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
          metadata: input.metadata ?? {},
        }),
      )
      .digest('hex');
  }
}
