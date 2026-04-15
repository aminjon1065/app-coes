import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AnalyticsEtlService {
  constructor(private readonly dataSource: DataSource) {}

  async materializeIncident(incidentId: string): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO analytics.fact_incidents (
          tenant_id,
          incident_id,
          opened_at,
          closed_at,
          duration_minutes,
          category,
          severity_peak,
          status_final,
          tasks_total,
          tasks_done,
          tasks_breached_sla,
          participants_count,
          sitreps_count
        )
        SELECT
          i.tenant_id,
          i.id,
          COALESCE(i.opened_at, i.created_at),
          i.closed_at,
          CASE
            WHEN i.closed_at IS NULL THEN NULL
            ELSE FLOOR(EXTRACT(EPOCH FROM (i.closed_at - COALESCE(i.opened_at, i.created_at))) / 60)::integer
          END,
          i.category,
          i.severity,
          i.status,
          COALESCE(task_stats.tasks_total, 0),
          COALESCE(task_stats.tasks_done, 0),
          COALESCE(task_stats.tasks_breached_sla, 0),
          COALESCE(participant_stats.participants_count, 0),
          COALESCE(sitrep_stats.sitreps_count, 0)
        FROM incident.incidents i
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::integer AS tasks_total,
            COUNT(*) FILTER (WHERE status = 'done')::integer AS tasks_done,
            COUNT(*) FILTER (
              WHERE sla_breach_at IS NOT NULL
                AND (completed_at IS NULL OR completed_at > sla_breach_at)
            )::integer AS tasks_breached_sla
          FROM task.tasks t
          WHERE t.incident_id = i.id AND t.deleted_at IS NULL
        ) task_stats ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::integer AS participants_count
          FROM incident.participants p
          WHERE p.incident_id = i.id AND p.left_at IS NULL
        ) participant_stats ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::integer AS sitreps_count
          FROM incident.sitreps s
          WHERE s.incident_id = i.id
        ) sitrep_stats ON true
        WHERE i.id = $1
        ON CONFLICT (incident_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          opened_at = EXCLUDED.opened_at,
          closed_at = EXCLUDED.closed_at,
          duration_minutes = EXCLUDED.duration_minutes,
          category = EXCLUDED.category,
          severity_peak = GREATEST(
            COALESCE(analytics.fact_incidents.severity_peak, EXCLUDED.severity_peak),
            COALESCE(EXCLUDED.severity_peak, analytics.fact_incidents.severity_peak)
          ),
          status_final = EXCLUDED.status_final,
          tasks_total = EXCLUDED.tasks_total,
          tasks_done = EXCLUDED.tasks_done,
          tasks_breached_sla = EXCLUDED.tasks_breached_sla,
          participants_count = EXCLUDED.participants_count,
          sitreps_count = EXCLUDED.sitreps_count
      `,
      [incidentId],
    );
  }

  async materializeTask(taskId: string): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO analytics.fact_tasks (
          tenant_id,
          task_id,
          incident_id,
          priority,
          status_final,
          time_to_start_minutes,
          time_to_complete_minutes,
          sla_breached,
          assignee_id,
          created_at
        )
        SELECT
          t.tenant_id,
          t.id,
          t.incident_id,
          t.priority,
          t.status,
          CASE
            WHEN t.started_at IS NULL THEN NULL
            ELSE FLOOR(EXTRACT(EPOCH FROM (t.started_at - t.created_at)) / 60)::integer
          END,
          CASE
            WHEN t.completed_at IS NULL THEN NULL
            ELSE FLOOR(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 60)::integer
          END,
          (
            t.sla_breach_at IS NOT NULL
            AND (t.completed_at IS NULL OR t.completed_at > t.sla_breach_at)
          ),
          t.assignee_id,
          t.created_at
        FROM task.tasks t
        WHERE t.id = $1 AND t.deleted_at IS NULL
        ON CONFLICT (task_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          incident_id = EXCLUDED.incident_id,
          priority = EXCLUDED.priority,
          status_final = EXCLUDED.status_final,
          time_to_start_minutes = EXCLUDED.time_to_start_minutes,
          time_to_complete_minutes = EXCLUDED.time_to_complete_minutes,
          sla_breached = EXCLUDED.sla_breached,
          assignee_id = EXCLUDED.assignee_id,
          created_at = EXCLUDED.created_at
      `,
      [taskId],
    );
  }
}
