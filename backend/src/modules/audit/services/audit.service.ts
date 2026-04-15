import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Brackets, DataSource, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { ListAuditEventsDto } from '../dto/list-audit-events.dto';

type CreateAuditEventInput = {
  tenantId: string;
  actorId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  ts?: Date;
  id?: string;
};

@Injectable()
export class AuditService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
  ) {}

  private get events(): Repository<AuditEventEntity> {
    return this.databaseContext.getRepository(
      this.dataSource,
      AuditEventEntity,
    );
  }

  async record(data: CreateAuditEventInput): Promise<void> {
    const entity = {
      id: data.id ?? randomUUID(),
      ts: data.ts ?? new Date(),
      tenantId: data.tenantId,
      actorId: data.actorId ?? null,
      eventType: data.eventType,
      targetType: data.targetType ?? null,
      targetId: data.targetId ?? null,
      before: data.before ?? null,
      after: data.after ?? null,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
      sessionId: data.sessionId ?? null,
    };

    await this.events.insert(entity as never);
  }

  async list(
    actor: RequestUser,
    query: ListAuditEventsDto,
  ): Promise<{
    data: AuditEventEntity[];
    page: { nextCursor: string | null; limit: number; hasMore: boolean };
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const qb = this.events
      .createQueryBuilder('audit')
      .orderBy('audit.ts', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .take(limit + 1);

    if (!actor.roles.includes('platform_admin')) {
      qb.where('audit.tenant_id = :tenantId', { tenantId: actor.tenantId });
    }

    if (query.actorId) {
      qb.andWhere('audit.actor_id = :actorId', { actorId: query.actorId });
    }
    if (query.eventType) {
      qb.andWhere('audit.event_type = :eventType', {
        eventType: query.eventType,
      });
    }
    if (query.targetType) {
      qb.andWhere('audit.target_type = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId) {
      qb.andWhere('audit.target_id = :targetId', { targetId: query.targetId });
    }
    if (query.from) {
      qb.andWhere('audit.ts >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('audit.ts <= :to', { to: query.to });
    }
    if (query.cursor) {
      const { ts, id } = this.parseCursor(query.cursor);
      qb.andWhere(
        new Brackets((cursorQb) => {
          cursorQb
            .where('audit.ts < :cursorTs', { cursorTs: ts.toISOString() })
            .orWhere('audit.ts = :cursorTs AND audit.id < :cursorId', {
              cursorTs: ts.toISOString(),
              cursorId: id,
            });
        }),
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return {
      data,
      page: {
        nextCursor: hasMore ? this.toCursor(data.at(-1)!) : null,
        limit,
        hasMore,
      },
    };
  }

  async findOne(actor: RequestUser, id: string): Promise<AuditEventEntity> {
    const qb = this.events
      .createQueryBuilder('audit')
      .where('audit.id = :id', { id });

    if (!actor.roles.includes('platform_admin')) {
      qb.andWhere('audit.tenant_id = :tenantId', { tenantId: actor.tenantId });
    }

    const event = await qb.orderBy('audit.ts', 'DESC').getOne();
    if (!event) {
      throw new NotFoundException('Audit event not found');
    }
    return event;
  }

  async exportCsv(
    actor: RequestUser,
    query: ListAuditEventsDto,
  ): Promise<string> {
    const { data } = await this.list(actor, {
      ...query,
      limit: Math.min(query.limit ?? 200, 200),
    });
    const header = [
      'id',
      'ts',
      'tenantId',
      'actorId',
      'eventType',
      'targetType',
      'targetId',
      'ip',
      'sessionId',
      'userAgent',
      'before',
      'after',
    ];

    const rows = data.map((item) => [
      item.id,
      item.ts.toISOString(),
      item.tenantId,
      item.actorId ?? '',
      item.eventType,
      item.targetType ?? '',
      item.targetId ?? '',
      item.ip ?? '',
      item.sessionId ?? '',
      item.userAgent ?? '',
      item.before ? JSON.stringify(item.before) : '',
      item.after ? JSON.stringify(item.after) : '',
    ]);

    return [header, ...rows]
      .map((row) => row.map((value) => this.csvEscape(String(value))).join(','))
      .join('\n');
  }

  private parseCursor(cursor: string): { ts: Date; id: string } {
    const [ts, id] = cursor.split('|');
    const parsed = new Date(ts);
    if (!ts || !id || Number.isNaN(parsed.getTime())) {
      throw new NotFoundException('Invalid audit cursor');
    }
    return { ts: parsed, id };
  }

  private toCursor(event: AuditEventEntity): string {
    return `${event.ts.toISOString()}|${event.id}`;
  }

  private csvEscape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
