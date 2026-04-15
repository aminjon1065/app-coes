import {
  Injectable,
  MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, Subject, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';

type RealtimeDomainEvent = {
  event: string;
  tenantId: string | null;
  incidentId: string | null;
  taskId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  emittedAt: string;
};

type RealtimeFilter = {
  tenantId: string;
  incidentId?: string | null;
  taskId?: string | null;
  eventPrefix?: string;
};

type DomainEventPayload = {
  tenantId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  actorId?: string | null;
} & Record<string, unknown>;

@Injectable()
export class RealtimeEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly events$ = new Subject<RealtimeDomainEvent>();

  private readonly listener = (
    event: string | string[] | symbol,
    payload: unknown,
  ) => {
    const name = Array.isArray(event)
      ? event.join('.')
      : typeof event === 'string'
        ? event
        : String(event);
    if (
      !name.startsWith('incident.') &&
      !name.startsWith('task.') &&
      !name.startsWith('gis.')
    ) {
      return;
    }

    const normalizedPayload =
      payload && typeof payload === 'object'
        ? (payload as DomainEventPayload)
        : {};

    this.events$.next({
      event: name,
      tenantId: normalizedPayload.tenantId ?? null,
      incidentId: normalizedPayload.incidentId ?? null,
      taskId: normalizedPayload.taskId ?? null,
      actorId: normalizedPayload.actorId ?? null,
      payload: normalizedPayload,
      emittedAt: new Date().toISOString(),
    });
  };

  constructor(private readonly events: EventEmitter2) {}

  onModuleInit() {
    this.events.onAny(this.listener);
  }

  onModuleDestroy() {
    this.events.offAny(this.listener);
    this.events$.complete();
  }

  stream(filterBy: RealtimeFilter): Observable<MessageEvent> {
    const heartbeat$ = interval(25_000).pipe(
      map(() => ({
        data: {
          event: 'heartbeat',
          emittedAt: new Date().toISOString(),
        },
      })),
    );

    const domainEvents$ = this.events$.pipe(
      filter((event) => {
        if (event.tenantId !== filterBy.tenantId) {
          return false;
        }
        if (
          filterBy.eventPrefix &&
          !event.event.startsWith(filterBy.eventPrefix)
        ) {
          return false;
        }
        if (filterBy.incidentId && event.incidentId !== filterBy.incidentId) {
          return false;
        }
        if (filterBy.taskId && event.taskId !== filterBy.taskId) {
          return false;
        }
        return true;
      }),
      map((event) => ({
        data: event,
      })),
    );

    return merge(domainEvents$, heartbeat$);
  }
}
