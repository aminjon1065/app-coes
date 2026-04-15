import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../services/audit.service';

type DomainEventPayload = {
  tenantId?: string | null;
  actorId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  userId?: string | null;
  fileId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
} & Record<string, unknown>;

@Injectable()
export class AuditListener implements OnModuleInit, OnModuleDestroy {
  private readonly listener = async (
    event: string | string[] | symbol,
    payload: unknown,
  ) => {
    const eventType = Array.isArray(event)
      ? event.join('.')
      : typeof event === 'string'
        ? event
        : String(event);

    if (eventType.startsWith('audit.') || eventType === 'heartbeat') {
      return;
    }

    const normalized =
      payload && typeof payload === 'object'
        ? (payload as DomainEventPayload)
        : {};

    if (!normalized.tenantId) {
      return;
    }

    await this.audit.record({
      tenantId: normalized.tenantId,
      actorId: normalized.actorId ?? null,
      eventType,
      targetType: this.resolveTargetType(eventType, normalized),
      targetId: this.resolveTargetId(normalized),
      before: this.normalizeJson(normalized.before),
      after: this.normalizeAfter(eventType, normalized),
      ip: normalized.ip ?? null,
      userAgent: normalized.userAgent ?? null,
      sessionId: normalized.sessionId ?? null,
    });
  };

  constructor(
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.events.onAny(this.listener);
  }

  onModuleDestroy() {
    this.events.offAny(this.listener);
  }

  private resolveTargetType(
    eventType: string,
    payload: DomainEventPayload,
  ): string | null {
    const prefix = eventType.split('.')[0];
    if (payload.incidentId) return 'incident';
    if (payload.taskId) return 'task';
    if (payload.userId) return prefix === 'notification' ? 'user' : prefix;
    if (payload.fileId) return 'file';
    if (payload.channelId) return 'channel';
    if (payload.messageId) return 'message';
    return prefix || null;
  }

  private resolveTargetId(payload: DomainEventPayload): string | null {
    return (
      payload.incidentId ??
      payload.taskId ??
      payload.userId ??
      payload.fileId ??
      payload.channelId ??
      payload.messageId ??
      null
    );
  }

  private normalizeAfter(
    eventType: string,
    payload: DomainEventPayload,
  ): Record<string, unknown> | null {
    if (payload.after && typeof payload.after === 'object') {
      return payload.after;
    }

    const clone = { ...payload };
    delete clone.tenantId;
    delete clone.actorId;
    delete clone.before;
    delete clone.after;
    delete clone.ip;
    delete clone.userAgent;
    delete clone.sessionId;

    return Object.keys(clone).length
      ? clone
      : this.fallbackAfter(eventType, payload);
  }

  private fallbackAfter(
    eventType: string,
    payload: DomainEventPayload,
  ): Record<string, unknown> | null {
    if (eventType.endsWith('.status_changed') && payload.after !== undefined) {
      return { after: payload.after };
    }
    return null;
  }

  private normalizeJson(
    value: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return value;
  }
}
