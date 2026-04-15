import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AnalyticsEtlService } from '../services/analytics-etl.service';

type IncidentEvent = {
  incidentId?: string | null;
  after?: string | null;
};

type TaskEvent = {
  taskId?: string | null;
  after?: string | null;
  status?: string | null;
};

@Injectable()
export class AnalyticsListener {
  constructor(private readonly etl: AnalyticsEtlService) {}

  @OnEvent('incident.status_changed', { async: true })
  async onIncidentStatusChanged(event: IncidentEvent) {
    if (event.incidentId && event.after === 'closed') {
      await this.etl.materializeIncident(event.incidentId);
    }
  }

  @OnEvent('incident.severity_changed', { async: true })
  @OnEvent('incident.participant_added', { async: true })
  @OnEvent('incident.participant_removed', { async: true })
  @OnEvent('incident.sitrep.submitted', { async: true })
  async onIncidentProjectionChanged(event: IncidentEvent) {
    if (event.incidentId) {
      await this.etl.materializeIncident(event.incidentId);
    }
  }

  @OnEvent('task.status_changed', { async: true })
  async onTaskStatusChanged(event: TaskEvent) {
    if (event.taskId && ['done', 'cancelled'].includes(event.after ?? event.status ?? '')) {
      await this.etl.materializeTask(event.taskId);
    }
  }

  @OnEvent('task.completed', { async: true })
  async onTaskCompleted(event: TaskEvent) {
    if (event.taskId) {
      await this.etl.materializeTask(event.taskId);
    }
  }
}
