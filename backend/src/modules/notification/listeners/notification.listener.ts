import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../services/notification.service';

type DomainEvent = {
  tenantId?: string;
  actorId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  newAssigneeId?: string | null;
  assigneeId?: string | null;
  severity?: string | number | null;
  before?: string | number | null;
  after?: string | number | null;
  userId?: string | null;
  reason?: string | null;
  commentId?: string | null;
} & Record<string, unknown>;

@Injectable()
export class NotificationListener {
  constructor(private readonly notifications: NotificationService) {}

  @OnEvent('incident.status_changed', { async: true })
  async onIncidentStatusChanged(payload: DomainEvent) {
    await this.notifyIncident('incident.status_changed', payload);
  }

  @OnEvent('incident.severity_changed', { async: true })
  async onIncidentSeverityChanged(payload: DomainEvent) {
    await this.notifyIncident('incident.severity_changed', payload);
  }

  @OnEvent('incident.commander_assigned', { async: true })
  async onIncidentCommanderAssigned(payload: DomainEvent) {
    await this.notifyIncident('incident.commander_assigned', payload);
  }

  @OnEvent('incident.participant_added', { async: true })
  async onIncidentParticipantAdded(payload: DomainEvent) {
    await this.notifyIncident('incident.participant_added', payload);
  }

  @OnEvent('incident.participant_removed', { async: true })
  async onIncidentParticipantRemoved(payload: DomainEvent) {
    await this.notifyIncident('incident.participant_removed', payload);
  }

  @OnEvent('incident.sitrep.submitted', { async: true })
  async onIncidentSitrepSubmitted(payload: DomainEvent) {
    await this.notifyIncident('incident.sitrep.submitted', payload);
  }

  @OnEvent('task.assigned', { async: true })
  async onTaskAssigned(payload: DomainEvent) {
    await this.notifyTask('task.assigned', payload);
  }

  @OnEvent('task.commented', { async: true })
  async onTaskCommented(payload: DomainEvent) {
    await this.notifyTask('task.commented', payload);
  }

  @OnEvent('task.completed', { async: true })
  async onTaskCompleted(payload: DomainEvent) {
    await this.notifyTask('task.completed', payload);
  }

  @OnEvent('task.status_changed', { async: true })
  async onTaskStatusChanged(payload: DomainEvent) {
    await this.notifyTask('task.status_changed', payload);
  }

  @OnEvent('iam.*', { async: true })
  async onIamEvent(_payload: DomainEvent) {}

  private async notifyIncident(eventType: string, payload: DomainEvent) {
    if (!payload.tenantId || !payload.incidentId) {
      return;
    }

    const recipients = await this.notifications.resolveIncidentRecipients(
      payload.tenantId,
      payload.incidentId,
      payload.actorId,
    );
    if (!recipients.length) {
      return;
    }

    const mapped = this.mapIncidentEvent(eventType, payload);
    if (!mapped) {
      return;
    }

    await this.notifications.dispatch({
      tenantId: payload.tenantId,
      actorId: payload.actorId,
      eventType,
      recipientIds: recipients,
      severity: payload.severity ?? payload.after,
      title: mapped.title,
      body: mapped.body,
      link: mapped.link,
      metadata: mapped.metadata,
    });
  }

  private async notifyTask(eventType: string, payload: DomainEvent) {
    if (!payload.tenantId || !payload.taskId) {
      return;
    }

    const recipients = await this.notifications.resolveTaskAssignee(
      payload.tenantId,
      payload.taskId,
      payload.newAssigneeId ?? payload.assigneeId ?? null,
    );
    const filteredRecipients = recipients.filter(
      (userId) => userId !== payload.actorId,
    );
    if (!filteredRecipients.length) {
      return;
    }

    const mapped = this.mapTaskEvent(eventType, payload);
    if (!mapped) {
      return;
    }

    await this.notifications.dispatch({
      tenantId: payload.tenantId,
      actorId: payload.actorId,
      eventType,
      recipientIds: filteredRecipients,
      title: mapped.title,
      body: mapped.body,
      link: mapped.link,
      metadata: mapped.metadata,
    });
  }

  private mapIncidentEvent(eventType: string, payload: DomainEvent) {
    const link = payload.incidentId ? `/incidents/${payload.incidentId}` : null;
    switch (eventType) {
      case 'incident.status_changed':
        return {
          title: 'Incident status updated',
          body: `Incident moved from ${payload.before ?? 'unknown'} to ${payload.after ?? 'unknown'}.`,
          link,
          metadata: {
            incidentId: payload.incidentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'incident.severity_changed':
        return {
          title: 'Incident severity changed',
          body: `Severity changed from ${payload.before ?? 'unknown'} to ${payload.after ?? 'unknown'}.`,
          link,
          metadata: {
            incidentId: payload.incidentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'incident.commander_assigned':
        return {
          title: 'Incident commander assigned',
          body: 'Incident command ownership was updated.',
          link,
          metadata: {
            incidentId: payload.incidentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'incident.participant_added':
      case 'incident.participant_removed':
        return {
          title: 'Incident participant roster changed',
          body: 'Incident participant membership was updated.',
          link,
          metadata: {
            incidentId: payload.incidentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'incident.sitrep.submitted':
        return {
          title: 'New situation report submitted',
          body: 'A fresh sitrep was added to the incident timeline.',
          link,
          metadata: {
            incidentId: payload.incidentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      default:
        return null;
    }
  }

  private mapTaskEvent(eventType: string, payload: DomainEvent) {
    const link = payload.taskId ? `/tasks?taskId=${payload.taskId}` : null;
    switch (eventType) {
      case 'task.assigned':
        return {
          title: 'Task assigned',
          body: 'A task was assigned or reassigned to you.',
          link,
          metadata: {
            taskId: payload.taskId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'task.commented':
        return {
          title: 'New task comment',
          body: 'A new comment was added to one of your tasks.',
          link,
          metadata: {
            taskId: payload.taskId,
            commentId: payload.commentId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'task.status_changed':
        return {
          title: 'Task status changed',
          body: `Task moved from ${payload.before ?? 'unknown'} to ${payload.after ?? 'unknown'}.`,
          link,
          metadata: {
            taskId: payload.taskId,
            eventId: this.eventId(eventType, payload),
          },
        };
      case 'task.completed':
        return {
          title: 'Task completed',
          body: 'A task assigned to you was marked as completed.',
          link,
          metadata: {
            taskId: payload.taskId,
            eventId: this.eventId(eventType, payload),
          },
        };
      default:
        return null;
    }
  }

  private eventId(eventType: string, payload: DomainEvent): string {
    return [
      eventType,
      payload.tenantId ?? '',
      payload.incidentId ?? '',
      payload.taskId ?? '',
      payload.commentId ?? '',
      payload.before ?? '',
      payload.after ?? '',
      payload.userId ?? '',
      payload.newAssigneeId ?? '',
    ].join(':');
  }
}
