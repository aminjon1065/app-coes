import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import {
  AnalyticsExportDto,
  AnalyticsRangeDto,
  IncidentVolumeDto,
  TaskThroughputDto,
} from '../dto/analytics-range.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(actor: RequestUser, query: AnalyticsRangeDto) {
    const { tenantId, from, to } = this.scope(actor, query);
    const [row] = await this.dataSource.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status_final IN ('open', 'escalated', 'contained'))::integer AS "openIncidents",
          COUNT(*) FILTER (WHERE status_final = 'closed')::integer AS "closedIncidents",
          COALESCE(ROUND(AVG(duration_minutes) FILTER (WHERE duration_minutes IS NOT NULL)), 0)::integer AS "avgResolutionMinutes",
          COALESCE(SUM(tasks_total), 0)::integer AS "tasksTotal",
          COALESCE(SUM(tasks_done), 0)::integer AS "tasksDone",
          COALESCE(SUM(tasks_breached_sla), 0)::integer AS "tasksBreachedSla",
          COALESCE(SUM(participants_count), 0)::integer AS "participantsTotal",
          COALESCE(SUM(sitreps_count), 0)::integer AS "sitrepsTotal"
        FROM analytics.fact_incidents
        WHERE tenant_id = $1
          AND opened_at >= $2
          AND opened_at <= $3
      `,
      [tenantId, from, to],
    );

    const [overdue] = await this.dataSource.query(
      `
        SELECT COUNT(*)::integer AS "overdueTasks"
        FROM task.tasks
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND due_at IS NOT NULL
          AND due_at < now()
          AND status NOT IN ('done', 'cancelled')
      `,
      [tenantId],
    );

    return { ...row, overdueTasks: overdue?.overdueTasks ?? 0 };
  }

  async incidentVolume(actor: RequestUser, query: IncidentVolumeDto) {
    const { tenantId, from, to } = this.scope(actor, query);
    const groupBy = query.groupBy ?? 'day';
    return this.dataSource.query(
      `
        SELECT
          date_trunc($4, opened_at)::date AS bucket,
          COUNT(*)::integer AS count
        FROM analytics.fact_incidents
        WHERE tenant_id = $1
          AND opened_at >= $2
          AND opened_at <= $3
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      [tenantId, from, to, groupBy],
    );
  }

  async taskThroughput(actor: RequestUser, query: TaskThroughputDto) {
    const { tenantId, from, to } = this.scope(actor, query);
    const params: unknown[] = [tenantId, from, to];
    let incidentFilter = '';
    if (query.incidentId) {
      params.push(query.incidentId);
      incidentFilter = `AND incident_id = $${params.length}`;
    }

    return this.dataSource.query(
      `
        SELECT
          status_final AS status,
          COUNT(*)::integer AS count,
          COALESCE(ROUND(AVG(time_to_start_minutes) FILTER (WHERE time_to_start_minutes IS NOT NULL)), 0)::integer AS "avgTimeToStartMinutes",
          COALESCE(ROUND(AVG(time_to_complete_minutes) FILTER (WHERE time_to_complete_minutes IS NOT NULL)), 0)::integer AS "avgTimeToCompleteMinutes"
        FROM analytics.fact_tasks
        WHERE tenant_id = $1
          AND created_at >= $2
          AND created_at <= $3
          ${incidentFilter}
        GROUP BY status_final
        ORDER BY status_final ASC
      `,
      params,
    );
  }

  async slaCompliance(actor: RequestUser, query: AnalyticsRangeDto) {
    const { tenantId, from, to } = this.scope(actor, query);
    const [row] = await this.dataSource.query(
      `
        SELECT
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE sla_breached)::integer AS breached,
          COUNT(*) FILTER (WHERE NOT sla_breached)::integer AS compliant,
          CASE
            WHEN COUNT(*) = 0 THEN 100
            ELSE ROUND((COUNT(*) FILTER (WHERE NOT sla_breached))::numeric / COUNT(*)::numeric * 100, 2)
          END AS "compliancePct"
        FROM analytics.fact_tasks
        WHERE tenant_id = $1
          AND created_at >= $2
          AND created_at <= $3
      `,
      [tenantId, from, to],
    );
    return row;
  }

  async byCategory(actor: RequestUser, query: AnalyticsRangeDto) {
    const { tenantId, from, to } = this.scope(actor, query);
    return this.dataSource.query(
      `
        SELECT
          COALESCE(category, 'unknown') AS category,
          COUNT(*)::integer AS count,
          COALESCE(MAX(severity_peak), 0)::integer AS "severityPeak",
          COALESCE(ROUND(AVG(duration_minutes) FILTER (WHERE duration_minutes IS NOT NULL)), 0)::integer AS "avgResolutionMinutes"
        FROM analytics.fact_incidents
        WHERE tenant_id = $1
          AND opened_at >= $2
          AND opened_at <= $3
        GROUP BY category
        ORDER BY count DESC, category ASC
      `,
      [tenantId, from, to],
    );
  }

  async exportCsv(actor: RequestUser, query: AnalyticsExportDto): Promise<string> {
    const { tenantId, from, to } = this.scope(actor, query);
    const type = query.type ?? 'incidents';
    const rows =
      type === 'tasks'
        ? await this.dataSource.query(
            `
              SELECT task_id, incident_id, priority, status_final, sla_breached, assignee_id, created_at
              FROM analytics.fact_tasks
              WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
              ORDER BY created_at DESC
            `,
            [tenantId, from, to],
          )
        : await this.dataSource.query(
            `
              SELECT incident_id, opened_at, closed_at, duration_minutes, category, severity_peak, status_final, tasks_total, tasks_done, tasks_breached_sla
              FROM analytics.fact_incidents
              WHERE tenant_id = $1 AND opened_at >= $2 AND opened_at <= $3
              ORDER BY opened_at DESC
            `,
            [tenantId, from, to],
          );

    if (!rows.length) {
      return '';
    }

    const header = Object.keys(rows[0]);
    return [header, ...rows.map((row: Record<string, unknown>) => header.map((key) => row[key]))]
      .map((row) => row.map((value) => this.csvEscape(value)).join(','))
      .join('\n');
  }

  private scope(actor: RequestUser, query: AnalyticsRangeDto) {
    const tenantId =
      actor.roles.includes('platform_admin') && query.tenantId
        ? query.tenantId
        : actor.tenantId;
    const now = new Date();
    const from = query.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = query.to ?? now.toISOString();
    return { tenantId, from, to };
  }

  private csvEscape(value: unknown): string {
    if (value == null) {
      return '""';
    }
    return `"${String(value).replace(/"/g, '""')}"`;
  }
}
