# Analytics Module -- Read-Side Reporting & Dashboards

## 1. Purpose

The Analytics module is the read-side reporting context of the CoESCD disaster management platform. It consumes domain events from all operational modules, denormalizes them into a star schema optimized for querying, and serves operational, tactical, and strategic dashboards to decision-makers at every level of the command hierarchy.

Analytics is a pure consumer -- it subscribes to all domain events (`*.v1`) via NATS JetStream durable consumers, transforms them into fact and dimension rows, and never writes back to any operational table. The entire module operates against its own `analytics` schema, isolated from operational concerns.

### Ownership Boundaries

Analytics **owns**:

- Fact tables (denormalized event-sourced records optimized for analytical queries)
- Dimension tables (slowly changing lookup tables for time, user, tenant, category)
- Materialized views (pre-aggregated rollups for dashboard performance)
- ETL pipeline (NATS JetStream consumer -> batch writer -> fact tables)
- Report generation (post-incident reports, scheduled exports, ad-hoc analyst queries)
- Dashboard query services (operational, tactical, strategic)
- Redis-based event deduplication (idempotency on `event.id`)
- Materialized view refresh scheduler

Analytics **does not own**:

- Operational data (owned by Incident, Task, Chat, IAM, GIS, Document modules)
- User identity and permissions (owned by IAM; analytics queries IAM for authorization and clearance)
- Notifications (owned by the Notification module; analytics emits `analytics.report.generated.v1` for downstream consumption)
- File storage (owned by the File module; generated reports reference exported files by ID)
- Real-time event streaming to clients (owned by the Notification/WebSocket layer; analytics serves polling/REST endpoints)

### Performance Targets

| Metric                                  | Target       |
| --------------------------------------- | ------------ |
| Event-to-fact ingestion lag (p95)       | < 30 seconds |
| Dashboard query response time (p95)     | < 500ms      |
| Materialized view refresh interval      | 60 seconds   |
| Post-incident report generation time    | < 60 seconds |
| Analyst SQL query timeout               | 30 seconds   |
| Maximum analyst query result set        | 10,000 rows  |

### Dashboard Tiers

| Dashboard    | Audience          | Refresh Cadence | Data Scope                          |
| ------------ | ----------------- | --------------- | ----------------------------------- |
| Operational  | Shift Lead        | Real-time (60s) | All active incidents in tenant      |
| Tactical     | Incident Commander| Real-time (60s) | Single incident, full lifecycle     |
| Strategic    | Ministry / Analyst| Hourly / daily  | Cross-incident, cross-region trends |

---

## 2. Domain Model

Analytics uses a star schema with fact tables at the center and dimension tables for common lookup axes. There are no aggregate roots or domain entities in the DDD sense -- this is a pure CQRS read model.

### Fact Tables (Denormalized)

#### fact_incident

The central fact table. One row per incident, updated as the incident progresses through its lifecycle.

| Column            | Type                     | Notes                                                                 |
| ----------------- | ------------------------ | --------------------------------------------------------------------- |
| incident_id       | uuid                     | PK, matches operational incident.incidents.id                         |
| tenant_id         | uuid                     | NOT NULL, RLS filter                                                  |
| code              | text                     | Incident code (e.g., EQ-2026-04-0012), immutable after insert         |
| category          | text                     | CHECK (category IN enum list), NOT NULL                               |
| severity          | smallint                 | CHECK (severity BETWEEN 1 AND 4), NOT NULL, updated on severity change|
| classification    | smallint                 | CHECK (classification BETWEEN 1 AND 4), default 1                     |
| status            | text                     | Current operational status, updated on status change                   |
| commander_id      | uuid                     | Nullable, updated on commander assignment                              |
| region            | text                     | Denormalized from tenant dimension, nullable                           |
| opened_at         | timestamptz              | Set on incident.created.v1 (if status=open) or status_changed to open |
| closed_at         | timestamptz              | Set on incident.closed.v1, cleared on reopen                          |
| duration_sec      | integer                  | Computed: EXTRACT(EPOCH FROM (closed_at - opened_at)), null if open    |
| response_time_sec | integer                  | Time from opened_at to first task assignment, null until measured       |
| mttr_sec          | integer                  | Mean time to resolve: opened_at to closed_at, null if open             |
| task_count        | integer                  | Incremented on task.created.v1, default 0                              |
| sitrep_count      | integer                  | Incremented on incident.sitrep.submitted.v1, default 0                 |
| participants      | integer                  | Count of unique participants, maintained on participant events          |
| created_at        | timestamptz              | Fact row creation timestamp                                            |
| updated_at        | timestamptz              | Last ETL update timestamp                                              |

#### fact_task_sla

One row per task. Tracks SLA compliance for every task across all incidents.

| Column        | Type        | Notes                                                              |
| ------------- | ----------- | ------------------------------------------------------------------ |
| task_id       | uuid        | PK, matches operational task.tasks.id                              |
| incident_id   | uuid        | Nullable (standalone tasks have no incident)                       |
| tenant_id     | uuid        | NOT NULL, RLS filter                                               |
| priority      | smallint    | CHECK (priority BETWEEN 1 AND 4), NOT NULL                        |
| assignee_id   | uuid        | Nullable                                                           |
| due_at        | timestamptz | Nullable, user-defined or SLA-computed deadline                    |
| completed_at  | timestamptz | Set on task.completed.v1                                           |
| breached      | boolean     | Default false, set to true on task.sla_breached.v1                 |
| delay_sec     | integer     | Computed: EXTRACT(EPOCH FROM (completed_at - due_at)), null/0 if on time |
| created_at    | timestamptz | Fact row creation timestamp                                        |
| updated_at    | timestamptz | Last ETL update timestamp                                          |

#### fact_message_volume

Daily aggregate of messaging activity per channel. One row per (date_key, channel_id).

| Column         | Type    | Notes                                                      |
| -------------- | ------- | ---------------------------------------------------------- |
| date_key       | date    | Part of composite PK                                       |
| channel_id     | uuid    | Part of composite PK                                       |
| tenant_id      | uuid    | NOT NULL, RLS filter                                       |
| incident_id    | uuid    | Nullable (channels not linked to incidents)                |
| message_count  | integer | Incremented on chat.message.posted.v1, default 0           |
| unique_authors | integer | Distinct author count for the day, maintained via HLL sketch|
| file_count     | integer | Messages with attachments, default 0                       |
| created_at     | timestamptz | Fact row creation timestamp                             |
| updated_at     | timestamptz | Last ETL update timestamp                               |

#### fact_sitrep

One row per situation report. Immutable after insert (sitreps are append-only in the operational model).

| Column      | Type                     | Notes                                              |
| ----------- | ------------------------ | -------------------------------------------------- |
| sitrep_id   | uuid                     | PK, matches operational incident.situation_reports.id |
| incident_id | uuid                     | NOT NULL                                           |
| tenant_id   | uuid                     | NOT NULL, RLS filter                               |
| reporter_id | uuid                     | NOT NULL                                           |
| severity    | smallint                 | CHECK (severity BETWEEN 1 AND 4), nullable          |
| location    | geography(Point, 4326)   | Nullable                                           |
| reported_at | timestamptz              | NOT NULL                                           |
| created_at  | timestamptz              | Fact row creation timestamp                         |

#### fact_user_activity

Daily aggregate of per-user activity. One row per (date_key, user_id).

| Column            | Type    | Notes                                                      |
| ----------------- | ------- | ---------------------------------------------------------- |
| date_key          | date    | Part of composite PK                                       |
| user_id           | uuid    | Part of composite PK                                       |
| tenant_id         | uuid    | NOT NULL, RLS filter                                       |
| login_count       | integer | Incremented on iam.session.opened.v1, default 0            |
| actions_count     | integer | Incremented on any user-initiated event, default 0          |
| incidents_touched | integer | Distinct incidents the user interacted with, default 0      |
| tasks_completed   | integer | Tasks completed by this user on this day, default 0         |
| created_at        | timestamptz | Fact row creation timestamp                             |
| updated_at        | timestamptz | Last ETL update timestamp                               |

### Dimension Tables

#### dim_time

Pre-populated calendar dimension. One row per day, covering the range 2020-01-01 through 2035-12-31.

| Column     | Type    | Notes                                         |
| ---------- | ------- | --------------------------------------------- |
| date_key   | date    | PK                                            |
| year       | smallint| EXTRACT(YEAR FROM date_key)                   |
| quarter    | smallint| EXTRACT(QUARTER FROM date_key), 1-4           |
| month      | smallint| EXTRACT(MONTH FROM date_key), 1-12            |
| day        | smallint| EXTRACT(DAY FROM date_key), 1-31              |
| dow        | smallint| EXTRACT(ISODOW FROM date_key), 1=Mon, 7=Sun   |
| iso_week   | smallint| EXTRACT(WEEK FROM date_key), 1-53             |
| is_weekend | boolean | dow IN (6, 7)                                 |
| is_holiday | boolean | Default false, manually maintained per tenant  |

#### dim_user

Slowly changing dimension (SCD Type 1 -- overwrite on change). Updated on IAM user events.

| Column     | Type     | Notes                                         |
| ---------- | -------- | --------------------------------------------- |
| user_id    | uuid     | PK                                            |
| tenant_id  | uuid     | NOT NULL                                      |
| role_codes | text[]   | Array of role codes (e.g., {'shift_lead','analyst'}) |
| region     | text     | Nullable, organizational region                |
| full_name  | text     | NOT NULL                                      |
| updated_at | timestamptz | Last dimension update                       |

#### dim_tenant

Slowly changing dimension (SCD Type 1). Updated on IAM tenant events.

| Column    | Type | Notes                                           |
| --------- | ---- | ----------------------------------------------- |
| tenant_id | uuid | PK                                              |
| code      | text | NOT NULL, unique tenant code                    |
| name      | text | NOT NULL                                        |
| region    | text | Nullable, geographic region                     |
| parent_id | uuid | Nullable, references dim_tenant(tenant_id)       |
| updated_at| timestamptz | Last dimension update                       |

#### dim_category

Static reference dimension for incident categories.

| Column | Type | Notes                              |
| ------ | ---- | ---------------------------------- |
| code   | text | PK (e.g., 'earthquake')           |
| name   | text | NOT NULL (e.g., 'Earthquake')     |
| icon   | text | NOT NULL, icon identifier          |
| color  | text | NOT NULL, hex color (e.g., '#D32F2F') |

### Materialized Views

#### mv_incident_daily

Per-day aggregation of incidents by severity, category, and tenant. Refreshed every 60 seconds.

```sql
SELECT
    d.date_key,
    f.tenant_id,
    f.category,
    f.severity,
    count(*)                                                    AS incident_count,
    count(*) FILTER (WHERE f.closed_at IS NOT NULL)             AS closed_count,
    avg(f.duration_sec) FILTER (WHERE f.duration_sec IS NOT NULL) AS avg_duration_sec,
    avg(f.response_time_sec) FILTER (WHERE f.response_time_sec IS NOT NULL) AS avg_response_time_sec,
    sum(f.task_count)                                           AS total_tasks,
    sum(f.sitrep_count)                                         AS total_sitreps
FROM analytics.fact_incident f
JOIN analytics.dim_time d ON d.date_key = f.opened_at::date
GROUP BY d.date_key, f.tenant_id, f.category, f.severity;
```

#### mv_sla_compliance

Per-week SLA breach rate by assignee team (derived from dim_user.region) and priority. Refreshed every 60 seconds.

```sql
SELECT
    date_trunc('week', ft.due_at)::date                        AS week_key,
    ft.tenant_id,
    du.region                                                   AS team_region,
    ft.priority,
    count(*)                                                    AS total_tasks,
    count(*) FILTER (WHERE ft.breached = true)                  AS breached_count,
    round(
        count(*) FILTER (WHERE ft.breached = true)::numeric
        / nullif(count(*), 0) * 100, 2
    )                                                           AS breach_rate_pct,
    avg(ft.delay_sec) FILTER (WHERE ft.delay_sec > 0)          AS avg_delay_sec
FROM analytics.fact_task_sla ft
LEFT JOIN analytics.dim_user du ON du.user_id = ft.assignee_id
WHERE ft.due_at IS NOT NULL
GROUP BY week_key, ft.tenant_id, du.region, ft.priority;
```

#### mv_response_time

Per-week percentile response times by category. Refreshed every 60 seconds.

```sql
SELECT
    date_trunc('week', f.opened_at)::date                      AS week_key,
    f.tenant_id,
    f.category,
    count(*)                                                    AS incident_count,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY f.response_time_sec) AS p50_response_sec,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY f.response_time_sec) AS p95_response_sec,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY f.response_time_sec) AS p99_response_sec,
    avg(f.mttr_sec) FILTER (WHERE f.mttr_sec IS NOT NULL)       AS avg_mttr_sec
FROM analytics.fact_incident f
WHERE f.response_time_sec IS NOT NULL
GROUP BY week_key, f.tenant_id, f.category;
```

#### mv_regional_heatmap

Per-tenant incident density and severity distribution. Refreshed every 60 seconds.

```sql
SELECT
    f.tenant_id,
    dt.region                                                   AS tenant_region,
    f.category,
    count(*)                                                    AS incident_count,
    count(*) FILTER (WHERE f.severity = 4)                      AS critical_count,
    count(*) FILTER (WHERE f.severity = 3)                      AS high_count,
    count(*) FILTER (WHERE f.severity = 2)                      AS moderate_count,
    count(*) FILTER (WHERE f.severity = 1)                      AS low_count,
    count(*) FILTER (WHERE f.status IN ('open','escalated'))    AS active_count,
    avg(f.duration_sec) FILTER (WHERE f.duration_sec IS NOT NULL) AS avg_duration_sec
FROM analytics.fact_incident f
JOIN analytics.dim_tenant dt ON dt.tenant_id = f.tenant_id
GROUP BY f.tenant_id, dt.region, f.category;
```

---

## 3. Business Rules

### Invariants

1. **Read-only consumer**: Analytics NEVER writes to operational tables. All data flows in one direction: operational events -> analytics facts. No command from analytics ever mutates operational state. The analytics database user has `SELECT` only on operational schemas (if cross-schema queries are ever needed for backfill), and `INSERT/UPDATE/SELECT` only on the `analytics` schema.

2. **Idempotent event processing**: Every consumed event is deduplicated on `event.id`. Before processing, the ETL worker checks a Redis SET (`analytics:dedup:{consumer_group}`) for the event ID. If present, the event is acknowledged and skipped. If absent, the event is processed, and the ID is added to the SET with a 24-hour TTL. This handles NATS JetStream at-least-once delivery guarantees.

3. **Batch writes**: Facts are not written one-at-a-time. The ETL worker buffers incoming events and flushes to PostgreSQL in batches of up to 1,000 rows or every 5 seconds, whichever threshold is reached first. Batch inserts use `INSERT ... ON CONFLICT` (upsert) to handle out-of-order and duplicate events gracefully.

4. **Materialized view refresh**: All materialized views are refreshed `CONCURRENTLY` every 60 seconds by a dedicated scheduler. Concurrent refresh allows queries to continue reading the old version while the new version is being built. If a refresh takes longer than 60 seconds, the next cycle is skipped, an alert is emitted, and the metric `analytics_mv_refresh_duration_seconds` is recorded.

5. **Read-replica routing**: All analyst-facing query endpoints and the SQL workbench route to a PostgreSQL read replica. Only the ETL worker writes to the primary. This ensures analytical load never impacts operational write performance.

6. **Multi-tenant isolation**: Every query (including materialized views) is filtered by `tenant_id`. RLS policies on all fact and dimension tables enforce this at the database level. There is no cross-tenant data leakage path.

7. **Data retention**: Fact tables retain detailed records for 5 years. After 5 years, rows are deleted by the retention job (runs weekly). Aggregated materialized view data is retained indefinitely -- it is small and valuable for long-term trend analysis.

8. **Classification-aware filtering**: Facts inherit the `classification` level from the source incident. Analysts with insufficient clearance (checked via IAM at query time) have their results automatically filtered. The classification check is applied as an additional WHERE clause: `classification <= :userClearance`.

9. **Timezone handling**: All timestamps are stored as `timestamptz` (UTC). Date keys in dimension and fact tables use UTC date boundaries. Dashboard responses include the timezone context from the requesting user's profile for client-side display conversion.

10. **No data mutation from API**: Dashboard and report endpoints are strictly read-only. The only write path is the ETL consumer processing events from NATS JetStream. There are no PATCH/PUT/DELETE endpoints in the analytics API.

### Constraints

| Constraint                                    | Enforcement         |
| --------------------------------------------- | ------------------- |
| fact_incident.incident_id unique              | PK                  |
| fact_task_sla.task_id unique                  | PK                  |
| fact_sitrep.sitrep_id unique                  | PK                  |
| fact_message_volume (date_key, channel_id) unique | Composite PK    |
| fact_user_activity (date_key, user_id) unique | Composite PK        |
| severity between 1 and 4                      | CHECK constraint    |
| classification between 1 and 4                | CHECK constraint    |
| priority between 1 and 4                      | CHECK constraint    |
| tenant_id NOT NULL on all fact tables         | NOT NULL constraint |
| Event deduplication on event.id               | Redis SET + TTL     |
| Batch size <= 1000 rows                       | Application config  |
| Analyst query timeout 30 seconds              | statement_timeout   |
| Analyst query max 10,000 result rows          | Application LIMIT   |

---

## 4. Use Cases

### Commands

#### IngestEvent (ETL Worker)

**Actor:** System (NATS JetStream consumer, no human actor)
**Input:** Domain event envelope from any module
**Flow:**

1. Receive event from NATS JetStream durable consumer (`analytics-etl` consumer group)
2. Check Redis dedup set for `event.id` -- if present, ACK and return
3. Route event to the appropriate handler based on `event.type` (see Section 6 for mapping)
4. Handler transforms event data into a fact table row (INSERT or UPDATE)
5. Add transformed row to the in-memory write buffer
6. If buffer size >= 1,000 rows OR 5 seconds since last flush: execute batch upsert
7. On successful flush: add all processed event IDs to Redis dedup set (24h TTL), ACK all events
8. On failure: NACK events for retry (NATS will redeliver after backoff)

**Idempotency:** Guaranteed by Redis dedup set + upsert semantics. Safe to replay any event.

#### RefreshMaterializedViews

**Actor:** System (cron scheduler, every 60 seconds)
**Input:** None
**Flow:**

1. Acquire advisory lock (`pg_advisory_xact_lock(hashtext('analytics_mv_refresh'))`) to prevent concurrent refreshes
2. For each materialized view (`mv_incident_daily`, `mv_sla_compliance`, `mv_response_time`, `mv_regional_heatmap`):
   a. Record start time
   b. Execute `REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.<view_name>`
   c. Record duration in `analytics_mv_refresh_duration_seconds` metric
   d. If duration > 60s: emit warning log, increment `analytics_mv_refresh_exceeded_total` counter
3. Release advisory lock

**Error handling:** If any single view refresh fails, log the error, skip to the next view, and alert. Do not abort the entire cycle.

#### GeneratePostIncidentReport

**Actor:** analyst, shift_lead+, or triggered automatically on incident.closed.v1
**Input:** incidentId
**Flow:**

1. Load `fact_incident` for the given incident
2. Load all `fact_task_sla` rows for the incident
3. Load all `fact_sitrep` rows for the incident, ordered by `reported_at`
4. Load `fact_message_volume` rows for the incident's date range
5. Query `mv_response_time` for the incident's category and time period (comparison baseline)
6. If timeline entries exceed 1,000: paginate in chunks of 500, process sequentially
7. Compile report sections: Executive Summary, Timeline, Task Performance, SLA Analysis, Communication Volume, Sitrep Summary, Lessons Learned (placeholder for manual input)
8. Generate PDF via report template engine
9. Store PDF in File module, receive file_id
10. Publish `analytics.report.generated.v1` with report metadata
11. Return report metadata (id, file_id, generated_at)

**Idempotency:** Report generation is idempotent on `(incident_id, report_type)`. Regenerating overwrites the previous report.

#### ScheduleReport

**Actor:** analyst, tenant_admin
**Input:** reportType (sla_compliance | response_time | user_activity | incident_summary), cronExpression, filters (tenant_id, date range, category), recipients (user IDs)
**Flow:**

1. Validate cron expression (must be valid, minimum interval 1 hour)
2. Validate filters (tenant_id must match actor's tenant)
3. Persist schedule to `analytics.report_schedules` table
4. Register cron job with the internal scheduler
5. On each trigger: generate report, store file, publish event, notify recipients

#### ExportReport

**Actor:** analyst
**Input:** reportId, format (pdf | csv | xlsx)
**Flow:**

1. Load report metadata from `analytics.reports` table
2. Verify actor has access (same tenant, sufficient clearance)
3. If format matches stored format: return file_id for direct download
4. If format differs: convert (e.g., re-query data and render in requested format)
5. Return file_id and download URL (presigned, 1-hour expiry)

### Queries

#### GetDashboardOperational

**Actor:** shift_lead+
**Parameters:** tenant_id
**Returns:** Real-time operational overview for the shift lead's tenant.

```typescript
interface OperationalDashboardDto {
  activeIncidents: {
    total: number;
    bySeverity: { critical: number; high: number; moderate: number; low: number };
    byCategory: Record<string, number>;
    byStatus: { open: number; escalated: number; contained: number };
  };
  taskOverview: {
    totalOpen: number;
    overdue: number;
    breachedToday: number;
    completedToday: number;
  };
  messageVolume: {
    last24h: number;
    trend: 'up' | 'down' | 'stable';
    trendPct: number;
  };
  responseTime: {
    avgLast24h: number | null;
    p95Last24h: number | null;
  };
  recentIncidents: IncidentSummaryDto[];  // last 10 created/updated
  recentSitreps: SitrepSummaryDto[];      // last 10 across all incidents
  generatedAt: string;                     // ISO 8601
}
```

**Implementation:** Queries `mv_incident_daily` for aggregates, `fact_task_sla` for task overview, `fact_message_volume` for comms, and `fact_incident` for recent items. Results cached in Redis for 30 seconds, invalidated on next MV refresh.

#### GetDashboardTactical

**Actor:** Incident participants (any role)
**Parameters:** incident_id
**Returns:** Full analytical view of a single incident.

```typescript
interface TacticalDashboardDto {
  incident: {
    id: string;
    code: string;
    title: string;
    category: string;
    severity: number;
    status: string;
    openedAt: string;
    closedAt: string | null;
    durationSec: number | null;
    responseTimeSec: number | null;
    mttrSec: number | null;
  };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    overdue: number;
    slaBreachRate: number;  // percentage
  };
  sitreps: {
    total: number;
    bySeverity: Record<number, number>;
    latest: SitrepSummaryDto[];  // last 5
  };
  communication: {
    totalMessages: number;
    uniqueAuthors: number;
    fileCount: number;
    dailyVolume: { date: string; count: number }[];
  };
  participants: {
    total: number;
    byRole: Record<string, number>;
  };
  timeline: {
    severityChanges: { ts: string; before: number; after: number }[];
    statusChanges: { ts: string; before: string; after: string }[];
  };
  generatedAt: string;
}
```

**Implementation:** Direct queries against fact tables filtered by `incident_id`. Not cached (tactical data must be current).

#### GetDashboardStrategic

**Actor:** analyst, tenant_admin
**Parameters:** tenant_id, period (last_7d | last_30d | last_90d | last_365d | custom), from?, to?
**Returns:** High-level strategic overview for ministry and executive decision-makers.

```typescript
interface StrategicDashboardDto {
  period: { from: string; to: string };
  summary: {
    totalIncidents: number;
    totalClosed: number;
    avgDurationSec: number;
    avgResponseTimeSec: number;
    avgMttrSec: number;
    slaBreachRate: number;
  };
  trends: {
    incidentsByWeek: { week: string; count: number; severity: Record<number, number> }[];
    responseTimeByWeek: { week: string; p50: number; p95: number }[];
    slaComplianceByWeek: { week: string; compliancePct: number }[];
  };
  categoryBreakdown: {
    category: string;
    count: number;
    avgDuration: number;
    avgResponseTime: number;
  }[];
  regionalBreakdown: {
    region: string;
    incidentCount: number;
    criticalCount: number;
    activeCount: number;
  }[];
  topIncidents: IncidentSummaryDto[];  // top 10 by duration or severity
  generatedAt: string;
}
```

**Implementation:** Queries materialized views exclusively. Cached in Redis for 5 minutes.

#### GetIncidentKPIs

**Actor:** analyst, shift_lead+
**Parameters:** tenant_id, from, to
**Returns:** Key performance indicators for the given period.

```typescript
interface IncidentKPIsDto {
  period: { from: string; to: string };
  totalIncidents: number;
  openIncidents: number;
  closedIncidents: number;
  avgResponseTimeSec: number | null;
  p95ResponseTimeSec: number | null;
  avgMttrSec: number | null;
  p95MttrSec: number | null;
  avgDurationSec: number | null;
  incidentsPerDay: number;
  bySeverity: Record<number, number>;
  byCategory: Record<string, number>;
}
```

#### GetSlaComplianceReport

**Actor:** analyst, shift_lead+
**Parameters:** tenant_id, from, to, priority? (filter), team_region? (filter)
**Returns:** SLA compliance breakdown.

```typescript
interface SlaComplianceDto {
  period: { from: string; to: string };
  overall: {
    totalTasks: number;
    breachedTasks: number;
    breachRate: number;
    avgDelaySec: number | null;
  };
  byPriority: {
    priority: number;
    totalTasks: number;
    breachedTasks: number;
    breachRate: number;
  }[];
  byWeek: {
    week: string;
    totalTasks: number;
    breachedTasks: number;
    breachRate: number;
  }[];
  byTeam: {
    teamRegion: string;
    totalTasks: number;
    breachedTasks: number;
    breachRate: number;
  }[];
}
```

**Implementation:** Reads from `mv_sla_compliance`. Falls back to `fact_task_sla` for custom filters not covered by the MV.

#### GetResponseTimeAnalysis

**Actor:** analyst, shift_lead+
**Parameters:** tenant_id, category?, from, to
**Returns:** Response time distribution and percentiles.

```typescript
interface ResponseTimeAnalysisDto {
  period: { from: string; to: string };
  overall: {
    p50: number; p95: number; p99: number;
    avg: number; min: number; max: number;
    sampleSize: number;
  };
  byWeek: {
    week: string;
    p50: number; p95: number; p99: number;
    sampleSize: number;
  }[];
  byCategory: {
    category: string;
    p50: number; p95: number; p99: number;
    sampleSize: number;
  }[];
}
```

**Implementation:** Reads from `mv_response_time`.

#### GetRegionalHeatmap

**Actor:** analyst, shift_lead+
**Parameters:** tenant_id
**Returns:** Regional incident density for map visualization.

```typescript
interface RegionalHeatmapDto {
  regions: {
    region: string;
    tenantId: string;
    tenantName: string;
    incidentCount: number;
    criticalCount: number;
    highCount: number;
    moderateCount: number;
    lowCount: number;
    activeCount: number;
    avgDurationSec: number | null;
  }[];
  generatedAt: string;
}
```

**Implementation:** Reads from `mv_regional_heatmap`. Cached in Redis for 60 seconds.

#### GetUserActivityReport

**Actor:** analyst, tenant_admin
**Parameters:** tenant_id, from, to, user_id? (filter)
**Returns:** User activity metrics.

```typescript
interface UserActivityReportDto {
  period: { from: string; to: string };
  users: {
    userId: string;
    fullName: string;
    region: string | null;
    totalLogins: number;
    totalActions: number;
    incidentsTouched: number;
    tasksCompleted: number;
    avgActionsPerDay: number;
  }[];
  summary: {
    totalActiveUsers: number;
    avgLoginsPerUser: number;
    avgTasksPerUser: number;
  };
}
```

**Implementation:** Reads from `fact_user_activity` joined with `dim_user`.

#### GetTrendAnalysis

**Actor:** analyst, shift_lead+
**Parameters:** metric (incidents | response_time | sla_compliance | message_volume | user_activity), tenant_id, from, to, granularity (day | week | month)
**Returns:** Time series data for the requested metric.

```typescript
interface TrendAnalysisDto {
  metric: string;
  granularity: string;
  period: { from: string; to: string };
  dataPoints: {
    periodKey: string;  // ISO date for day, ISO week for week, YYYY-MM for month
    value: number;
    metadata?: Record<string, number>;  // additional breakdowns
  }[];
}
```

**Implementation:** Dynamically queries the appropriate MV or fact table with `date_trunc` grouping.

#### RunCustomQuery (Analyst SQL Workbench)

**Actor:** analyst (with `analytics.query` permission)
**Input:** sql (raw SQL string), params? (parameterized values)
**Flow:**

1. Validate SQL: must be a SELECT statement (reject INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/GRANT/REVOKE)
2. Inject tenant_id filter: parse SQL, ensure all referenced analytics tables have `tenant_id = :tenantId` in WHERE clause. If missing, reject with `ANALYTICS_QUERY_INVALID`
3. Set `statement_timeout = '30s'` on the session
4. Execute against read replica
5. Apply `LIMIT 10001` to detect overflow. If 10,001 rows returned, truncate to 10,000 and set `truncated: true`
6. Return columns, rows, row count, execution time, and truncation flag

```typescript
interface CustomQueryResultDto {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
}
```

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max,
  IsUUID, IsDateString, IsObject, MaxLength, IsBoolean,
  IsArray, ValidateNested, IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Shared DTOs ──────────────────────────────────────────

export class PaginationDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DateRangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class IncidentSummaryDto {
  id: string;
  code: string;
  title: string;
  category: string;
  severity: number;
  status: string;
  openedAt: string;
  closedAt: string | null;
  durationSec: number | null;
}

export class SitrepSummaryDto {
  sitrepId: string;
  incidentId: string;
  reporterId: string;
  severity: number | null;
  reportedAt: string;
}

// ── Query Parameter DTOs ─────────────────────────────────

export class OperationalDashboardQueryDto {
  @IsUUID()
  tenant_id: string;
}

export class TacticalDashboardQueryDto {
  @IsUUID()
  incident_id: string;
}

export class StrategicDashboardQueryDto {
  @IsUUID()
  tenant_id: string;

  @IsEnum(['last_7d', 'last_30d', 'last_90d', 'last_365d', 'custom'])
  period: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class IncidentKPIsQueryDto {
  @IsUUID()
  tenant_id: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class SlaComplianceQueryDto {
  @IsUUID()
  tenant_id: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @IsOptional()
  @IsString()
  team_region?: string;
}

export class ResponseTimeQueryDto {
  @IsUUID()
  tenant_id: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class HeatmapQueryDto {
  @IsUUID()
  tenant_id: string;
}

export class UserActivityQueryDto {
  @IsUUID()
  tenant_id: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;
}

export class TrendQueryDto {
  @IsEnum(['incidents', 'response_time', 'sla_compliance', 'message_volume', 'user_activity'])
  metric: string;

  @IsUUID()
  tenant_id: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsEnum(['day', 'week', 'month'])
  granularity: string;
}

export class ScheduleReportDto {
  @IsEnum(['sla_compliance', 'response_time', 'user_activity', 'incident_summary', 'post_incident'])
  reportType: string;

  @IsString()
  @MaxLength(100)
  cronExpression: string;

  @IsUUID()
  tenantId: string;

  @IsOptional()
  @IsDateString()
  filterFrom?: string;

  @IsOptional()
  @IsDateString()
  filterTo?: string;

  @IsOptional()
  @IsString()
  filterCategory?: string;

  @IsArray()
  @IsUUID('all', { each: true })
  recipientIds: string[];
}

export class CustomQueryDto {
  @IsString()
  @MaxLength(10000)
  sql: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

// ── Response DTOs ────────────────────────────────────────

export class ReportDto {
  id: string;
  reportType: string;
  incidentId: string | null;
  tenantId: string;
  fileId: string;
  format: string;
  generatedAt: string;
  generatedBy: string;
}

export class ReportScheduleDto {
  id: string;
  reportType: string;
  cronExpression: string;
  tenantId: string;
  recipientIds: string[];
  lastRunAt: string | null;
  nextRunAt: string;
  createdBy: string;
  createdAt: string;
}
```

### Endpoints

```
GET    /api/v1/analytics/dashboard/operational
  Query: tenant_id (required, UUID)
  Response 200: { data: OperationalDashboardDto }
  Errors: 403 (insufficient role — requires shift_lead+)

GET    /api/v1/analytics/dashboard/tactical
  Query: incident_id (required, UUID)
  Response 200: { data: TacticalDashboardDto }
  Errors: 403 (not an incident participant), 404 ANALYTICS_INCIDENT_NOT_FOUND

GET    /api/v1/analytics/dashboard/strategic
  Query: tenant_id (required, UUID), period (required), from? (required if period=custom), to? (required if period=custom)
  Response 200: { data: StrategicDashboardDto }
  Errors: 403 (requires analyst or tenant_admin)

GET    /api/v1/analytics/incidents/kpis
  Query: tenant_id (required, UUID), from (required, ISO date), to (required, ISO date)
  Response 200: { data: IncidentKPIsDto }
  Errors: 403

GET    /api/v1/analytics/sla/compliance
  Query: tenant_id (required, UUID), from (required), to (required), priority? (1-4), team_region? (string)
  Response 200: { data: SlaComplianceDto }
  Errors: 403

GET    /api/v1/analytics/response-time
  Query: tenant_id (required, UUID), category? (string), from (required), to (required)
  Response 200: { data: ResponseTimeAnalysisDto }
  Errors: 403

GET    /api/v1/analytics/heatmap
  Query: tenant_id (required, UUID)
  Response 200: { data: RegionalHeatmapDto }
  Errors: 403

GET    /api/v1/analytics/users/activity
  Query: tenant_id (required, UUID), from (required), to (required), user_id? (UUID)
  Response 200: { data: UserActivityReportDto }
  Errors: 403

GET    /api/v1/analytics/trends
  Query: metric (required, enum), tenant_id (required, UUID), from (required), to (required), granularity (required, day|week|month)
  Response 200: { data: TrendAnalysisDto }
  Errors: 403

POST   /api/v1/analytics/reports/schedule
  Body: ScheduleReportDto
  Response 201: { data: ReportScheduleDto }
  Errors: 400 (invalid cron), 403

GET    /api/v1/analytics/reports
  Query: tenant_id (required, UUID), cursor?, limit? (1-100, default 25), report_type? (filter)
  Response 200: { data: ReportDto[], page: { nextCursor, prevCursor, limit, hasMore } }
  Errors: 403

GET    /api/v1/analytics/reports/:id
  Response 200: { data: ReportDto }
  Errors: 404 ANALYTICS_REPORT_NOT_FOUND, 403

GET    /api/v1/analytics/reports/:id/download
  Query: format? (pdf|csv|xlsx, default: original)
  Response 200: { data: { downloadUrl: string, expiresAt: string } }
  Errors: 404, 403

POST   /api/v1/analytics/query
  Body: CustomQueryDto
  Response 200: { data: CustomQueryResultDto }
  Errors: 400 ANALYTICS_QUERY_INVALID (non-SELECT, missing tenant filter),
          408 ANALYTICS_QUERY_TIMEOUT (exceeded 30s),
          403 (requires analytics.query permission)
```

### Error Codes

| Code                              | HTTP | Description                                                                     |
| --------------------------------- | ---- | ------------------------------------------------------------------------------- |
| ANALYTICS_QUERY_TIMEOUT           | 408  | Analyst SQL query exceeded the 30-second timeout and was terminated              |
| ANALYTICS_QUERY_INVALID           | 400  | SQL query is not a valid SELECT, or is missing required tenant_id filter         |
| ANALYTICS_REPORT_NOT_FOUND        | 404  | Requested report does not exist or is not accessible to the requesting user      |
| ANALYTICS_INSUFFICIENT_CLEARANCE  | 403  | User's clearance level is below the classification of the requested data         |
| ANALYTICS_INCIDENT_NOT_FOUND      | 404  | No analytics data exists for the requested incident (not yet ingested or invalid)|
| ANALYTICS_INVALID_PERIOD          | 400  | Custom period requires both from and to parameters                               |
| ANALYTICS_EXPORT_FORMAT_INVALID   | 400  | Requested export format is not supported                                         |
| ANALYTICS_SCHEDULE_INVALID_CRON   | 400  | Cron expression is invalid or below minimum interval (1 hour)                    |

---

## 6. Events

### Event Envelope

All consumed events follow the platform standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event — used for dedup
  type: string;        // e.g., "incident.created.v1"
  source: string;      // e.g., "incident-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Consumed Events

Analytics subscribes to NATS JetStream subjects `incident.>`, `task.>`, `chat.>`, `iam.>`, `document.>`, and `gis.>` via a durable consumer named `analytics-etl`. Each event type maps to a specific fact table transformation.

#### incident.created.v1

**Source:** Incident module
**Handler:** Insert new row into `fact_incident`. Upsert `dim_category` if unknown category code is encountered.

```typescript
@EventHandler('incident.created.v1')
async handle(event: EventEnvelope<IncidentCreatedData>): Promise<void> {
  const { incidentId, code, category, severity, status, classification, openedAt, createdBy } = event.data;

  this.buffer.add({
    table: 'fact_incident',
    op: 'upsert',
    row: {
      incident_id: incidentId,
      tenant_id: event.tenantId,
      code,
      category,
      severity,
      classification: classification ?? 1,
      status,
      commander_id: event.data.commanderId ?? null,
      region: await this.lookupTenantRegion(event.tenantId),
      opened_at: openedAt ?? null,
      closed_at: null,
      duration_sec: null,
      response_time_sec: null,
      mttr_sec: null,
      task_count: 0,
      sitrep_count: 0,
      participants: 0,
      created_at: event.timestamp,
      updated_at: event.timestamp,
    },
  });

  // Upsert dimension
  await this.ensureDimCategory(category);
}
```

#### incident.closed.v1

**Source:** Incident module
**Handler:** Update `fact_incident` with `closed_at`, compute `duration_sec` and `mttr_sec`.

```typescript
@EventHandler('incident.closed.v1')
async handle(event: EventEnvelope<IncidentClosedData>): Promise<void> {
  const { incidentId, openedAt, closedAt, durationSec } = event.data;

  this.buffer.add({
    table: 'fact_incident',
    op: 'update',
    key: { incident_id: incidentId },
    set: {
      status: 'closed',
      closed_at: closedAt,
      duration_sec: durationSec,
      mttr_sec: durationSec,  // MTTR = duration for single-resolution incidents
      updated_at: event.timestamp,
    },
  });
}
```

#### incident.severity_changed.v1

**Source:** Incident module
**Handler:** Update `fact_incident.severity`.

```typescript
@EventHandler('incident.severity_changed.v1')
async handle(event: EventEnvelope<SeverityChangedData>): Promise<void> {
  this.buffer.add({
    table: 'fact_incident',
    op: 'update',
    key: { incident_id: event.data.incidentId },
    set: {
      severity: event.data.after,
      updated_at: event.timestamp,
    },
  });
}
```

#### incident.status_changed.v1

**Source:** Incident module
**Handler:** Update `fact_incident.status`. Handle reopen (clear `closed_at`).

```typescript
@EventHandler('incident.status_changed.v1')
async handle(event: EventEnvelope<StatusChangedData>): Promise<void> {
  const set: Record<string, unknown> = {
    status: event.data.after,
    updated_at: event.timestamp,
  };

  // Handle reopen: clear closed_at and duration
  if (event.data.after === 'open' && event.data.before === 'closed') {
    set.closed_at = null;
    set.duration_sec = null;
    set.mttr_sec = null;
  }

  // Handle open from draft: set opened_at
  if (event.data.after === 'open' && event.data.before === 'draft') {
    set.opened_at = event.timestamp;
  }

  this.buffer.add({
    table: 'fact_incident',
    op: 'update',
    key: { incident_id: event.data.incidentId },
    set,
  });
}
```

#### incident.participant_added.v1

**Source:** Incident module
**Handler:** Increment `fact_incident.participants`.

```typescript
@EventHandler('incident.participant_added.v1')
async handle(event: EventEnvelope<ParticipantAddedData>): Promise<void> {
  this.buffer.add({
    table: 'fact_incident',
    op: 'increment',
    key: { incident_id: event.data.incidentId },
    column: 'participants',
    delta: 1,
  });
}
```

#### incident.participant_removed.v1

**Source:** Incident module
**Handler:** Decrement `fact_incident.participants` (floor at 0).

#### incident.commander_assigned.v1

**Source:** Incident module
**Handler:** Update `fact_incident.commander_id`.

#### incident.sitrep.submitted.v1

**Source:** Incident module
**Handler:** Insert row into `fact_sitrep`. Increment `fact_incident.sitrep_count`.

```typescript
@EventHandler('incident.sitrep.submitted.v1')
async handle(event: EventEnvelope<SitrepSubmittedData>): Promise<void> {
  const { incidentId, sitrepId, reporterId, severity, location } = event.data;

  this.buffer.add({
    table: 'fact_sitrep',
    op: 'upsert',
    row: {
      sitrep_id: sitrepId,
      incident_id: incidentId,
      tenant_id: event.tenantId,
      reporter_id: reporterId,
      severity: severity ?? null,
      location: location ? `SRID=4326;POINT(${location.lng} ${location.lat})` : null,
      reported_at: event.timestamp,
      created_at: event.timestamp,
    },
  });

  this.buffer.add({
    table: 'fact_incident',
    op: 'increment',
    key: { incident_id: incidentId },
    column: 'sitrep_count',
    delta: 1,
  });
}
```

#### task.created.v1

**Source:** Task module
**Handler:** Insert row into `fact_task_sla`. Increment `fact_incident.task_count` (if incident-linked).

```typescript
@EventHandler('task.created.v1')
async handle(event: EventEnvelope<TaskCreatedData>): Promise<void> {
  const { taskId, incidentId, priority, assigneeId, dueAt, slaBreachAt } = event.data;

  this.buffer.add({
    table: 'fact_task_sla',
    op: 'upsert',
    row: {
      task_id: taskId,
      incident_id: incidentId ?? null,
      tenant_id: event.tenantId,
      priority,
      assignee_id: assigneeId ?? null,
      due_at: slaBreachAt ?? dueAt ?? null,
      completed_at: null,
      breached: false,
      delay_sec: null,
      created_at: event.timestamp,
      updated_at: event.timestamp,
    },
  });

  if (incidentId) {
    this.buffer.add({
      table: 'fact_incident',
      op: 'increment',
      key: { incident_id: incidentId },
      column: 'task_count',
      delta: 1,
    });

    // Compute response_time_sec if this is the first task for the incident
    await this.maybeSetResponseTime(incidentId, event.timestamp);
  }
}
```

#### task.completed.v1

**Source:** Task module
**Handler:** Update `fact_task_sla` with `completed_at` and compute `delay_sec`. Update `fact_user_activity.tasks_completed`.

```typescript
@EventHandler('task.completed.v1')
async handle(event: EventEnvelope<TaskCompletedData>): Promise<void> {
  const { taskId, completedAt, assigneeId } = event.data;

  this.buffer.add({
    table: 'fact_task_sla',
    op: 'update',
    key: { task_id: taskId },
    set: {
      completed_at: completedAt,
      updated_at: event.timestamp,
    },
    // delay_sec computed in SQL: EXTRACT(EPOCH FROM (completed_at - due_at)) where due_at IS NOT NULL
  });

  if (assigneeId) {
    const dateKey = event.timestamp.substring(0, 10); // YYYY-MM-DD
    this.buffer.add({
      table: 'fact_user_activity',
      op: 'upsert_increment',
      key: { date_key: dateKey, user_id: assigneeId },
      defaults: { tenant_id: event.tenantId, login_count: 0, actions_count: 0, incidents_touched: 0, tasks_completed: 0 },
      increment: { tasks_completed: 1 },
    });
  }
}
```

#### task.sla_breached.v1

**Source:** Task module
**Handler:** Update `fact_task_sla.breached = true`.

```typescript
@EventHandler('task.sla_breached.v1')
async handle(event: EventEnvelope<TaskSlaBreachedData>): Promise<void> {
  this.buffer.add({
    table: 'fact_task_sla',
    op: 'update',
    key: { task_id: event.data.taskId },
    set: {
      breached: true,
      updated_at: event.timestamp,
    },
  });
}
```

#### task.assigned.v1

**Source:** Task module
**Handler:** Update `fact_task_sla.assignee_id`.

#### chat.message.posted.v1

**Source:** Chat module
**Handler:** Upsert `fact_message_volume` for the (date, channel) pair. Increment counts.

```typescript
@EventHandler('chat.message.posted.v1')
async handle(event: EventEnvelope<MessagePostedData>): Promise<void> {
  const { channelId, incidentId, authorId, hasAttachments } = event.data;
  const dateKey = event.timestamp.substring(0, 10);

  this.buffer.add({
    table: 'fact_message_volume',
    op: 'upsert_increment',
    key: { date_key: dateKey, channel_id: channelId },
    defaults: {
      tenant_id: event.tenantId,
      incident_id: incidentId ?? null,
      message_count: 0,
      unique_authors: 0,
      file_count: 0,
    },
    increment: {
      message_count: 1,
      file_count: hasAttachments ? 1 : 0,
    },
  });

  // Track unique authors via Redis HyperLogLog for the day
  const hllKey = `analytics:hll:authors:${dateKey}:${channelId}`;
  await this.redis.pfadd(hllKey, authorId);
  await this.redis.expire(hllKey, 172800); // 48h TTL
}
```

#### iam.session.opened.v1

**Source:** IAM module
**Handler:** Upsert `fact_user_activity` for the (date, user) pair. Increment `login_count`.

```typescript
@EventHandler('iam.session.opened.v1')
async handle(event: EventEnvelope<SessionOpenedData>): Promise<void> {
  const { userId } = event.data;
  const dateKey = event.timestamp.substring(0, 10);

  this.buffer.add({
    table: 'fact_user_activity',
    op: 'upsert_increment',
    key: { date_key: dateKey, user_id: userId },
    defaults: {
      tenant_id: event.tenantId,
      login_count: 0,
      actions_count: 0,
      incidents_touched: 0,
      tasks_completed: 0,
    },
    increment: { login_count: 1 },
  });

  // Upsert dim_user if not present
  await this.ensureDimUser(userId, event.tenantId);
}
```

#### iam.user.created.v1 / iam.user.updated.v1

**Source:** IAM module
**Handler:** Upsert `dim_user` dimension row.

#### iam.tenant.created.v1 / iam.tenant.updated.v1

**Source:** IAM module
**Handler:** Upsert `dim_tenant` dimension row.

#### incident.reopened.v1

**Source:** Incident module
**Handler:** Clear `fact_incident.closed_at`, `duration_sec`, `mttr_sec`. Set status to `open`.

#### incident.geofence_updated.v1 / incident.epicenter_updated.v1

**Source:** Incident module
**Handler:** No fact table impact (geospatial data not stored in analytics facts). Logged for audit only.

### Event-to-Fact Mapping Summary

| Event                            | Primary Fact Table      | Operation                                    |
| -------------------------------- | ----------------------- | -------------------------------------------- |
| incident.created.v1              | fact_incident           | INSERT (upsert)                              |
| incident.closed.v1              | fact_incident           | UPDATE (closed_at, duration, mttr)            |
| incident.severity_changed.v1    | fact_incident           | UPDATE (severity)                             |
| incident.status_changed.v1      | fact_incident           | UPDATE (status, conditionally opened_at/closed_at) |
| incident.participant_added.v1   | fact_incident           | INCREMENT (participants)                      |
| incident.participant_removed.v1 | fact_incident           | DECREMENT (participants)                      |
| incident.commander_assigned.v1  | fact_incident           | UPDATE (commander_id)                         |
| incident.sitrep.submitted.v1    | fact_sitrep + fact_incident | INSERT + INCREMENT (sitrep_count)         |
| incident.reopened.v1            | fact_incident           | UPDATE (clear closed_at, duration, mttr)      |
| task.created.v1                 | fact_task_sla + fact_incident | INSERT + INCREMENT (task_count)          |
| task.completed.v1               | fact_task_sla + fact_user_activity | UPDATE + INCREMENT (tasks_completed)|
| task.sla_breached.v1            | fact_task_sla           | UPDATE (breached = true)                      |
| task.assigned.v1                | fact_task_sla           | UPDATE (assignee_id)                          |
| chat.message.posted.v1          | fact_message_volume     | UPSERT + INCREMENT                            |
| iam.session.opened.v1           | fact_user_activity      | UPSERT + INCREMENT (login_count)              |
| iam.user.created.v1             | dim_user                | UPSERT                                        |
| iam.user.updated.v1             | dim_user                | UPSERT                                        |
| iam.tenant.created.v1           | dim_tenant              | UPSERT                                        |
| iam.tenant.updated.v1           | dim_tenant              | UPSERT                                        |

### Produced Events

#### analytics.report.generated.v1

Published when a report (post-incident or scheduled) is successfully generated.

```json
{
  "id": "019526a0-7c00-7000-8000-000000000201",
  "type": "analytics.report.generated.v1",
  "source": "analytics-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T18:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000300",
  "data": {
    "reportId": "019526a0-7c00-7000-8000-000000000210",
    "reportType": "post_incident",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "fileId": "019526a0-7c00-7000-8000-000000000220",
    "format": "pdf",
    "generatedAt": "2026-04-12T18:00:00.000Z",
    "generatedBy": "system"
  }
}
```

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS analytics;

-- =============================================================================
-- Roles and permissions
-- =============================================================================
-- ETL worker role: can INSERT/UPDATE/SELECT on analytics schema
-- App (query) role: can SELECT only on analytics schema
-- Neither role has any privileges on operational schemas

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_etl') THEN
    CREATE ROLE analytics_etl;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_reader') THEN
    CREATE ROLE analytics_reader;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA analytics TO analytics_etl, analytics_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO analytics_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT, INSERT, UPDATE ON TABLES TO analytics_etl;

-- =============================================================================
-- Dimension: dim_time (pre-populated calendar)
-- =============================================================================
CREATE TABLE analytics.dim_time (
    date_key    date        PRIMARY KEY,
    year        smallint    NOT NULL,
    quarter     smallint    NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    month       smallint    NOT NULL CHECK (month BETWEEN 1 AND 12),
    day         smallint    NOT NULL CHECK (day BETWEEN 1 AND 31),
    dow         smallint    NOT NULL CHECK (dow BETWEEN 1 AND 7),
    iso_week    smallint    NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
    is_weekend  boolean     NOT NULL DEFAULT false,
    is_holiday  boolean     NOT NULL DEFAULT false
);

-- Populate dim_time for 2020-01-01 through 2035-12-31
INSERT INTO analytics.dim_time (date_key, year, quarter, month, day, dow, iso_week, is_weekend, is_holiday)
SELECT
    d::date                                     AS date_key,
    EXTRACT(YEAR FROM d)::smallint              AS year,
    EXTRACT(QUARTER FROM d)::smallint           AS quarter,
    EXTRACT(MONTH FROM d)::smallint             AS month,
    EXTRACT(DAY FROM d)::smallint               AS day,
    EXTRACT(ISODOW FROM d)::smallint            AS dow,
    EXTRACT(WEEK FROM d)::smallint              AS iso_week,
    EXTRACT(ISODOW FROM d) IN (6, 7)            AS is_weekend,
    false                                        AS is_holiday
FROM generate_series('2020-01-01'::date, '2035-12-31'::date, '1 day'::interval) AS d
ON CONFLICT (date_key) DO NOTHING;

-- =============================================================================
-- Dimension: dim_user (SCD Type 1)
-- =============================================================================
CREATE TABLE analytics.dim_user (
    user_id     uuid        PRIMARY KEY,
    tenant_id   uuid        NOT NULL,
    role_codes  text[]      NOT NULL DEFAULT '{}',
    region      text,
    full_name   text        NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dim_user_tenant ON analytics.dim_user (tenant_id);

-- =============================================================================
-- Dimension: dim_tenant (SCD Type 1)
-- =============================================================================
CREATE TABLE analytics.dim_tenant (
    tenant_id   uuid        PRIMARY KEY,
    code        text        NOT NULL,
    name        text        NOT NULL,
    region      text,
    parent_id   uuid        REFERENCES analytics.dim_tenant(tenant_id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Dimension: dim_category (static reference)
-- =============================================================================
CREATE TABLE analytics.dim_category (
    code    text    PRIMARY KEY,
    name    text    NOT NULL,
    icon    text    NOT NULL,
    color   text    NOT NULL
);

INSERT INTO analytics.dim_category (code, name, icon, color) VALUES
    ('earthquake',     'Earthquake',      'earthquake',     '#D32F2F'),
    ('flood',          'Flood',           'flood',          '#1565C0'),
    ('fire',           'Fire',            'fire',           '#E65100'),
    ('wildfire',       'Wildfire',        'wildfire',       '#BF360C'),
    ('industrial',     'Industrial',      'factory',        '#4E342E'),
    ('cbrn',           'CBRN',            'biohazard',      '#6A1B9A'),
    ('mass_gathering', 'Mass Gathering',  'people',         '#00695C'),
    ('medical',        'Medical',         'medical',        '#C62828'),
    ('transport',      'Transport',       'transport',      '#283593'),
    ('other',          'Other',           'alert',          '#424242')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- Fact: fact_incident (partitioned by opened_at month)
-- =============================================================================
CREATE TABLE analytics.fact_incident (
    incident_id       uuid            NOT NULL,
    tenant_id         uuid            NOT NULL,
    code              text            NOT NULL,
    category          text            NOT NULL,
    severity          smallint        NOT NULL CHECK (severity BETWEEN 1 AND 4),
    classification    smallint        NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
    status            text            NOT NULL,
    commander_id      uuid,
    region            text,
    opened_at         timestamptz,
    closed_at         timestamptz,
    duration_sec      integer,
    response_time_sec integer,
    mttr_sec          integer,
    task_count        integer         NOT NULL DEFAULT 0,
    sitrep_count      integer         NOT NULL DEFAULT 0,
    participants      integer         NOT NULL DEFAULT 0,
    created_at        timestamptz     NOT NULL DEFAULT now(),
    updated_at        timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, opened_at)
) PARTITION BY RANGE (opened_at);

-- Create partitions for 2024 through 2027 (extend as needed)
DO $$
DECLARE
    y integer;
    m integer;
    start_date date;
    end_date date;
    part_name text;
BEGIN
    FOR y IN 2024..2027 LOOP
        FOR m IN 1..12 LOOP
            start_date := make_date(y, m, 1);
            end_date := start_date + interval '1 month';
            part_name := format('fact_incident_%s_%s', y, lpad(m::text, 2, '0'));
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.fact_incident
                 FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END LOOP;
    END LOOP;
END
$$;

-- Default partition for rows with NULL opened_at or out-of-range dates
CREATE TABLE IF NOT EXISTS analytics.fact_incident_default
    PARTITION OF analytics.fact_incident DEFAULT;

-- Indexes on fact_incident
CREATE INDEX idx_fact_incident_tenant ON analytics.fact_incident (tenant_id);
CREATE INDEX idx_fact_incident_tenant_status ON analytics.fact_incident (tenant_id, status);
CREATE INDEX idx_fact_incident_tenant_category ON analytics.fact_incident (tenant_id, category);
CREATE INDEX idx_fact_incident_tenant_severity ON analytics.fact_incident (tenant_id, severity);
CREATE INDEX idx_fact_incident_tenant_opened ON analytics.fact_incident (tenant_id, opened_at DESC);
CREATE INDEX idx_fact_incident_classification ON analytics.fact_incident (classification);

-- =============================================================================
-- Fact: fact_task_sla (partitioned by due_at month)
-- =============================================================================
CREATE TABLE analytics.fact_task_sla (
    task_id       uuid            NOT NULL,
    incident_id   uuid,
    tenant_id     uuid            NOT NULL,
    priority      smallint        NOT NULL CHECK (priority BETWEEN 1 AND 4),
    assignee_id   uuid,
    due_at        timestamptz,
    completed_at  timestamptz,
    breached      boolean         NOT NULL DEFAULT false,
    delay_sec     integer,
    created_at    timestamptz     NOT NULL DEFAULT now(),
    updated_at    timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for 2024 through 2027
DO $$
DECLARE
    y integer;
    m integer;
    start_date date;
    end_date date;
    part_name text;
BEGIN
    FOR y IN 2024..2027 LOOP
        FOR m IN 1..12 LOOP
            start_date := make_date(y, m, 1);
            end_date := start_date + interval '1 month';
            part_name := format('fact_task_sla_%s_%s', y, lpad(m::text, 2, '0'));
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.fact_task_sla
                 FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END LOOP;
    END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS analytics.fact_task_sla_default
    PARTITION OF analytics.fact_task_sla DEFAULT;

-- Indexes on fact_task_sla
CREATE INDEX idx_fact_task_sla_tenant ON analytics.fact_task_sla (tenant_id);
CREATE INDEX idx_fact_task_sla_incident ON analytics.fact_task_sla (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_fact_task_sla_breached ON analytics.fact_task_sla (tenant_id, breached) WHERE breached = true;
CREATE INDEX idx_fact_task_sla_priority ON analytics.fact_task_sla (tenant_id, priority);
CREATE INDEX idx_fact_task_sla_due ON analytics.fact_task_sla (due_at) WHERE due_at IS NOT NULL;
CREATE INDEX idx_fact_task_sla_assignee ON analytics.fact_task_sla (assignee_id) WHERE assignee_id IS NOT NULL;

-- =============================================================================
-- Fact: fact_message_volume
-- =============================================================================
CREATE TABLE analytics.fact_message_volume (
    date_key       date        NOT NULL,
    channel_id     uuid        NOT NULL,
    tenant_id      uuid        NOT NULL,
    incident_id    uuid,
    message_count  integer     NOT NULL DEFAULT 0,
    unique_authors integer     NOT NULL DEFAULT 0,
    file_count     integer     NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date_key, channel_id)
) PARTITION BY RANGE (date_key);

-- Create partitions by quarter for 2024 through 2027
DO $$
DECLARE
    y integer;
    q integer;
    start_date date;
    end_date date;
    part_name text;
BEGIN
    FOR y IN 2024..2027 LOOP
        FOR q IN 1..4 LOOP
            start_date := make_date(y, (q - 1) * 3 + 1, 1);
            end_date := start_date + interval '3 months';
            part_name := format('fact_message_volume_%s_q%s', y, q);
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.fact_message_volume
                 FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END LOOP;
    END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS analytics.fact_message_volume_default
    PARTITION OF analytics.fact_message_volume DEFAULT;

-- Indexes on fact_message_volume
CREATE INDEX idx_fact_msg_vol_tenant ON analytics.fact_message_volume (tenant_id);
CREATE INDEX idx_fact_msg_vol_incident ON analytics.fact_message_volume (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_fact_msg_vol_date_tenant ON analytics.fact_message_volume (tenant_id, date_key DESC);

-- =============================================================================
-- Fact: fact_sitrep
-- =============================================================================
CREATE TABLE analytics.fact_sitrep (
    sitrep_id   uuid                     NOT NULL,
    incident_id uuid                     NOT NULL,
    tenant_id   uuid                     NOT NULL,
    reporter_id uuid                     NOT NULL,
    severity    smallint                 CHECK (severity BETWEEN 1 AND 4),
    location    geography(Point, 4326),
    reported_at timestamptz              NOT NULL,
    created_at  timestamptz              NOT NULL DEFAULT now(),
    PRIMARY KEY (sitrep_id, reported_at)
) PARTITION BY RANGE (reported_at);

-- Create partitions by month for 2024 through 2027
DO $$
DECLARE
    y integer;
    m integer;
    start_date date;
    end_date date;
    part_name text;
BEGIN
    FOR y IN 2024..2027 LOOP
        FOR m IN 1..12 LOOP
            start_date := make_date(y, m, 1);
            end_date := start_date + interval '1 month';
            part_name := format('fact_sitrep_%s_%s', y, lpad(m::text, 2, '0'));
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.fact_sitrep
                 FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END LOOP;
    END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS analytics.fact_sitrep_default
    PARTITION OF analytics.fact_sitrep DEFAULT;

-- Indexes on fact_sitrep
CREATE INDEX idx_fact_sitrep_tenant ON analytics.fact_sitrep (tenant_id);
CREATE INDEX idx_fact_sitrep_incident ON analytics.fact_sitrep (incident_id);
CREATE INDEX idx_fact_sitrep_reporter ON analytics.fact_sitrep (reporter_id);
CREATE INDEX idx_fact_sitrep_location ON analytics.fact_sitrep USING GIST (location);

-- =============================================================================
-- Fact: fact_user_activity (partitioned by date_key quarter)
-- =============================================================================
CREATE TABLE analytics.fact_user_activity (
    date_key          date        NOT NULL,
    user_id           uuid        NOT NULL,
    tenant_id         uuid        NOT NULL,
    login_count       integer     NOT NULL DEFAULT 0,
    actions_count     integer     NOT NULL DEFAULT 0,
    incidents_touched integer     NOT NULL DEFAULT 0,
    tasks_completed   integer     NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date_key, user_id)
) PARTITION BY RANGE (date_key);

-- Create partitions by quarter for 2024 through 2027
DO $$
DECLARE
    y integer;
    q integer;
    start_date date;
    end_date date;
    part_name text;
BEGIN
    FOR y IN 2024..2027 LOOP
        FOR q IN 1..4 LOOP
            start_date := make_date(y, (q - 1) * 3 + 1, 1);
            end_date := start_date + interval '3 months';
            part_name := format('fact_user_activity_%s_q%s', y, q);
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.fact_user_activity
                 FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END LOOP;
    END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS analytics.fact_user_activity_default
    PARTITION OF analytics.fact_user_activity DEFAULT;

-- Indexes on fact_user_activity
CREATE INDEX idx_fact_user_act_tenant ON analytics.fact_user_activity (tenant_id);
CREATE INDEX idx_fact_user_act_user ON analytics.fact_user_activity (user_id);
CREATE INDEX idx_fact_user_act_date_tenant ON analytics.fact_user_activity (tenant_id, date_key DESC);

-- =============================================================================
-- Reports table
-- =============================================================================
CREATE TABLE analytics.reports (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    report_type     text            NOT NULL CHECK (report_type IN (
                                        'post_incident', 'sla_compliance', 'response_time',
                                        'user_activity', 'incident_summary'
                                    )),
    incident_id     uuid,
    file_id         uuid            NOT NULL,
    format          text            NOT NULL CHECK (format IN ('pdf', 'csv', 'xlsx')),
    generated_by    uuid            NOT NULL,
    generated_at    timestamptz     NOT NULL DEFAULT now(),
    metadata        jsonb           NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_reports_tenant ON analytics.reports (tenant_id);
CREATE INDEX idx_reports_incident ON analytics.reports (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_reports_type ON analytics.reports (tenant_id, report_type);

-- =============================================================================
-- Report schedules table
-- =============================================================================
CREATE TABLE analytics.report_schedules (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    report_type     text            NOT NULL CHECK (report_type IN (
                                        'sla_compliance', 'response_time',
                                        'user_activity', 'incident_summary'
                                    )),
    cron_expression text            NOT NULL,
    filters         jsonb           NOT NULL DEFAULT '{}',
    recipient_ids   uuid[]          NOT NULL DEFAULT '{}',
    is_active       boolean         NOT NULL DEFAULT true,
    last_run_at     timestamptz,
    next_run_at     timestamptz     NOT NULL,
    created_by      uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_schedules_tenant ON analytics.report_schedules (tenant_id);
CREATE INDEX idx_report_schedules_next_run ON analytics.report_schedules (next_run_at) WHERE is_active = true;

-- =============================================================================
-- Materialized Views (must have UNIQUE index for CONCURRENTLY refresh)
-- =============================================================================

-- mv_incident_daily
CREATE MATERIALIZED VIEW analytics.mv_incident_daily AS
SELECT
    d.date_key,
    f.tenant_id,
    f.category,
    f.severity,
    count(*)                                                              AS incident_count,
    count(*) FILTER (WHERE f.closed_at IS NOT NULL)                       AS closed_count,
    avg(f.duration_sec) FILTER (WHERE f.duration_sec IS NOT NULL)         AS avg_duration_sec,
    avg(f.response_time_sec) FILTER (WHERE f.response_time_sec IS NOT NULL) AS avg_response_time_sec,
    sum(f.task_count)                                                      AS total_tasks,
    sum(f.sitrep_count)                                                    AS total_sitreps
FROM analytics.fact_incident f
JOIN analytics.dim_time d ON d.date_key = f.opened_at::date
GROUP BY d.date_key, f.tenant_id, f.category, f.severity
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_incident_daily_pk
    ON analytics.mv_incident_daily (date_key, tenant_id, category, severity);
CREATE INDEX idx_mv_incident_daily_tenant
    ON analytics.mv_incident_daily (tenant_id, date_key DESC);

-- mv_sla_compliance
CREATE MATERIALIZED VIEW analytics.mv_sla_compliance AS
SELECT
    date_trunc('week', ft.due_at)::date                                   AS week_key,
    ft.tenant_id,
    du.region                                                              AS team_region,
    ft.priority,
    count(*)                                                               AS total_tasks,
    count(*) FILTER (WHERE ft.breached = true)                             AS breached_count,
    round(
        count(*) FILTER (WHERE ft.breached = true)::numeric
        / nullif(count(*), 0) * 100, 2
    )                                                                      AS breach_rate_pct,
    avg(ft.delay_sec) FILTER (WHERE ft.delay_sec > 0)                     AS avg_delay_sec
FROM analytics.fact_task_sla ft
LEFT JOIN analytics.dim_user du ON du.user_id = ft.assignee_id
WHERE ft.due_at IS NOT NULL
GROUP BY week_key, ft.tenant_id, du.region, ft.priority
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_sla_compliance_pk
    ON analytics.mv_sla_compliance (week_key, tenant_id, team_region, priority);
CREATE INDEX idx_mv_sla_compliance_tenant
    ON analytics.mv_sla_compliance (tenant_id, week_key DESC);

-- mv_response_time
CREATE MATERIALIZED VIEW analytics.mv_response_time AS
SELECT
    date_trunc('week', f.opened_at)::date                                  AS week_key,
    f.tenant_id,
    f.category,
    count(*)                                                                AS incident_count,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY f.response_time_sec)      AS p50_response_sec,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY f.response_time_sec)      AS p95_response_sec,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY f.response_time_sec)      AS p99_response_sec,
    avg(f.mttr_sec) FILTER (WHERE f.mttr_sec IS NOT NULL)                  AS avg_mttr_sec
FROM analytics.fact_incident f
WHERE f.response_time_sec IS NOT NULL
GROUP BY week_key, f.tenant_id, f.category
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_response_time_pk
    ON analytics.mv_response_time (week_key, tenant_id, category);
CREATE INDEX idx_mv_response_time_tenant
    ON analytics.mv_response_time (tenant_id, week_key DESC);

-- mv_regional_heatmap
CREATE MATERIALIZED VIEW analytics.mv_regional_heatmap AS
SELECT
    f.tenant_id,
    dt.region                                                               AS tenant_region,
    f.category,
    count(*)                                                                AS incident_count,
    count(*) FILTER (WHERE f.severity = 4)                                  AS critical_count,
    count(*) FILTER (WHERE f.severity = 3)                                  AS high_count,
    count(*) FILTER (WHERE f.severity = 2)                                  AS moderate_count,
    count(*) FILTER (WHERE f.severity = 1)                                  AS low_count,
    count(*) FILTER (WHERE f.status IN ('open','escalated'))                AS active_count,
    avg(f.duration_sec) FILTER (WHERE f.duration_sec IS NOT NULL)           AS avg_duration_sec
FROM analytics.fact_incident f
JOIN analytics.dim_tenant dt ON dt.tenant_id = f.tenant_id
GROUP BY f.tenant_id, dt.region, f.category
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_regional_heatmap_pk
    ON analytics.mv_regional_heatmap (tenant_id, tenant_region, category);

-- Initial refresh (run after ETL has populated fact tables)
-- REFRESH MATERIALIZED VIEW analytics.mv_incident_daily;
-- REFRESH MATERIALIZED VIEW analytics.mv_sla_compliance;
-- REFRESH MATERIALIZED VIEW analytics.mv_response_time;
-- REFRESH MATERIALIZED VIEW analytics.mv_regional_heatmap;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
ALTER TABLE analytics.fact_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_task_sla ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_message_volume ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_sitrep ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.report_schedules ENABLE ROW LEVEL SECURITY;

-- RLS policies: tenant isolation
CREATE POLICY tenant_isolation_fact_incident ON analytics.fact_incident
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_fact_task_sla ON analytics.fact_task_sla
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_fact_message_volume ON analytics.fact_message_volume
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_fact_sitrep ON analytics.fact_sitrep
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_fact_user_activity ON analytics.fact_user_activity
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_reports ON analytics.reports
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_report_schedules ON analytics.report_schedules
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Classification-aware RLS on fact_incident
CREATE POLICY classification_filter_fact_incident ON analytics.fact_incident
    USING (classification <= current_setting('app.current_clearance')::smallint);

-- ETL worker bypasses RLS (uses analytics_etl role with BYPASSRLS or separate policy)
CREATE POLICY etl_full_access_fact_incident ON analytics.fact_incident
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_fact_task_sla ON analytics.fact_task_sla
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_fact_message_volume ON analytics.fact_message_volume
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_fact_sitrep ON analytics.fact_sitrep
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_fact_user_activity ON analytics.fact_user_activity
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_reports ON analytics.reports
    TO analytics_etl USING (true) WITH CHECK (true);
CREATE POLICY etl_full_access_report_schedules ON analytics.report_schedules
    TO analytics_etl USING (true) WITH CHECK (true);

-- =============================================================================
-- Updated_at trigger (reusable)
-- =============================================================================
CREATE OR REPLACE FUNCTION analytics.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fact_incident_updated_at
    BEFORE UPDATE ON analytics.fact_incident
    FOR EACH ROW EXECUTE FUNCTION analytics.set_updated_at();

CREATE TRIGGER trg_fact_task_sla_updated_at
    BEFORE UPDATE ON analytics.fact_task_sla
    FOR EACH ROW EXECUTE FUNCTION analytics.set_updated_at();

CREATE TRIGGER trg_fact_message_volume_updated_at
    BEFORE UPDATE ON analytics.fact_message_volume
    FOR EACH ROW EXECUTE FUNCTION analytics.set_updated_at();

CREATE TRIGGER trg_fact_user_activity_updated_at
    BEFORE UPDATE ON analytics.fact_user_activity
    FOR EACH ROW EXECUTE FUNCTION analytics.set_updated_at();

-- =============================================================================
-- Data retention: scheduled deletion of facts older than 5 years
-- Run weekly via pg_cron or application scheduler
-- =============================================================================
-- DELETE FROM analytics.fact_incident WHERE opened_at < now() - interval '5 years';
-- DELETE FROM analytics.fact_task_sla WHERE created_at < now() - interval '5 years';
-- DELETE FROM analytics.fact_message_volume WHERE date_key < (current_date - interval '5 years');
-- DELETE FROM analytics.fact_sitrep WHERE reported_at < now() - interval '5 years';
-- DELETE FROM analytics.fact_user_activity WHERE date_key < (current_date - interval '5 years');
-- Old partitions can also be detached and dropped for faster cleanup.
```

---

## 8. Permissions

### Permission Matrix

| Permission         | Description                                                 | Roles                            |
| ------------------ | ----------------------------------------------------------- | -------------------------------- |
| analytics.read     | View dashboards and pre-built reports                       | analyst, shift_lead, tenant_admin|
| analytics.export   | Export reports in PDF/CSV/XLSX                               | analyst, tenant_admin            |
| analytics.query    | Execute custom SQL via analyst workbench (read-replica)     | analyst                          |
| analytics.schedule | Create and manage scheduled report jobs                      | analyst, tenant_admin            |

### Dashboard Access Control

| Dashboard   | Required Role                | Additional Constraint                                      |
| ----------- | ---------------------------- | ---------------------------------------------------------- |
| Operational | shift_lead+                  | Filtered by actor's tenant_id                              |
| Tactical    | Any incident participant     | Actor must be an active participant of the incident         |
| Strategic   | analyst, tenant_admin        | Filtered by actor's tenant_id; cross-tenant requires system_admin |

### Classification Enforcement

All analytics queries enforce classification-based filtering. The user's clearance level (from IAM) is compared against the incident's `classification` field:

```typescript
// Applied as middleware before every analytics query
function applyClassificationFilter(query: SelectQueryBuilder, user: AuthenticatedUser): void {
  // user.clearance is set by IAM: 1=PUBLIC, 2=INTERNAL, 3=CONFIDENTIAL, 4=SECRET
  query.andWhere('classification <= :clearance', { clearance: user.clearance });
}
```

Users with `PUBLIC` (1) clearance only see incidents classified as `PUBLIC`. Users with `SECRET` (4) clearance see all incidents. This applies uniformly across all dashboards, reports, and the SQL workbench.

### SQL Workbench Guardrails

The analyst SQL workbench (`POST /api/v1/analytics/query`) enforces additional restrictions:

1. **SELECT only**: Queries are parsed and rejected if they contain DML or DDL statements
2. **Tenant filter mandatory**: The query must include `tenant_id = <value>` in the WHERE clause for every referenced table, or the system injects it
3. **Read-replica only**: Queries execute against the read replica, never the primary
4. **Timeout**: `SET LOCAL statement_timeout = '30000'` applied per session
5. **Row limit**: Results capped at 10,000 rows
6. **Audit logging**: Every query is logged with user_id, SQL text, execution time, and row count
7. **Blocked functions**: `pg_sleep`, `pg_advisory_lock`, `set_config`, `pg_terminate_backend` and similar are rejected at the SQL parsing stage

---

## 9. Edge Cases

### Out-of-Order Events

**Scenario:** `incident.closed.v1` arrives before `incident.created.v1`.

**Resolution:** The ETL worker uses `INSERT ... ON CONFLICT (incident_id) DO UPDATE` (upsert) semantics. If `incident.closed.v1` arrives first, a partial row is inserted with only the fields available from the close event. When `incident.created.v1` subsequently arrives, the upsert fills in the missing fields using `COALESCE` to avoid overwriting already-populated values:

```sql
INSERT INTO analytics.fact_incident (incident_id, tenant_id, code, category, severity, ...)
VALUES ($1, $2, $3, $4, $5, ...)
ON CONFLICT (incident_id, opened_at) DO UPDATE SET
    code = COALESCE(analytics.fact_incident.code, EXCLUDED.code),
    category = COALESCE(analytics.fact_incident.category, EXCLUDED.category),
    severity = COALESCE(EXCLUDED.severity, analytics.fact_incident.severity),
    closed_at = COALESCE(EXCLUDED.closed_at, analytics.fact_incident.closed_at),
    duration_sec = CASE
        WHEN EXCLUDED.closed_at IS NOT NULL AND analytics.fact_incident.opened_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (EXCLUDED.closed_at - analytics.fact_incident.opened_at))::integer
        WHEN analytics.fact_incident.closed_at IS NOT NULL AND EXCLUDED.opened_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (analytics.fact_incident.closed_at - EXCLUDED.opened_at))::integer
        ELSE analytics.fact_incident.duration_sec
    END,
    updated_at = greatest(analytics.fact_incident.updated_at, EXCLUDED.updated_at);
```

For `fact_incident` which is partitioned by `opened_at`, an event arriving without `opened_at` (e.g., a close event for which the create event hasn't arrived yet) is routed to the default partition. When the create event subsequently arrives with the actual `opened_at`, the row is deleted from the default partition and re-inserted into the correct monthly partition within a single transaction.

### Duplicate Events

**Scenario:** NATS JetStream redelivers the same event (same `event.id`).

**Resolution:** Before processing, the ETL worker checks the Redis dedup set:

```typescript
async processEvent(event: EventEnvelope<unknown>): Promise<void> {
  const dedupKey = `analytics:dedup:etl`;
  const added = await this.redis.sadd(dedupKey, event.id);
  if (added === 0) {
    // Already processed — ACK and skip
    return;
  }
  await this.redis.expire(dedupKey, 86400); // 24h TTL on the set

  // Process normally...
}
```

Additionally, upsert semantics at the database level make duplicate inserts a no-op or idempotent update.

### Materialized View Refresh Exceeds 60 Seconds

**Scenario:** A view refresh takes longer than the 60-second cycle interval.

**Resolution:**

1. The advisory lock prevents concurrent refresh attempts. If the lock is already held, the new cycle skips entirely.
2. Duration is tracked via `analytics_mv_refresh_duration_seconds` Prometheus histogram.
3. If any view refresh exceeds 60 seconds, an alert is emitted to the ops channel.
4. Investigation path: check for bloated fact tables, missing indexes on source tables, or lock contention. Consider increasing the refresh interval or optimizing the MV query.

```typescript
async refreshViews(): Promise<void> {
  const acquired = await this.db.query(
    `SELECT pg_try_advisory_lock(hashtext('analytics_mv_refresh'))`,
  );
  if (!acquired.rows[0].pg_try_advisory_lock) {
    this.logger.warn('MV refresh skipped: previous cycle still running');
    this.metrics.increment('analytics_mv_refresh_skipped_total');
    return;
  }

  try {
    for (const view of MATERIALIZED_VIEWS) {
      const start = Date.now();
      await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.${view}`);
      const durationMs = Date.now() - start;
      this.metrics.histogram('analytics_mv_refresh_duration_seconds', durationMs / 1000, { view });

      if (durationMs > 60_000) {
        this.logger.error(`MV refresh for ${view} took ${durationMs}ms — exceeds 60s threshold`);
        this.metrics.increment('analytics_mv_refresh_exceeded_total', { view });
      }
    }
  } finally {
    await this.db.query(`SELECT pg_advisory_unlock(hashtext('analytics_mv_refresh'))`);
  }
}
```

### Analyst SQL Query Too Expensive

**Scenario:** An analyst submits a query that runs beyond the 30-second timeout.

**Resolution:**

1. `statement_timeout` is set to 30 seconds at the session level before executing the query
2. PostgreSQL automatically cancels the query when the timeout fires
3. The API returns `ANALYTICS_QUERY_TIMEOUT` (HTTP 408)
4. The query text, user_id, and execution duration are logged for auditing
5. Repeated offenders (>5 timeouts per hour) trigger a rate limit on the SQL workbench endpoint for that user

```typescript
async executeCustomQuery(sql: string, tenantId: string, user: AuthenticatedUser): Promise<QueryResult> {
  const client = await this.readReplicaPool.connect();
  try {
    await client.query(`SET LOCAL statement_timeout = '30000'`);
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    await client.query(`SET LOCAL app.current_clearance = '${user.clearance}'`);

    const start = Date.now();
    const result = await client.query(sql);
    const durationMs = Date.now() - start;

    this.auditLog.record({
      userId: user.id,
      action: 'analytics.custom_query',
      sql,
      durationMs,
      rowCount: result.rowCount,
    });

    return result;
  } catch (error) {
    if (error.code === '57014') { // query_canceled
      throw new AnalyticsQueryTimeoutError();
    }
    throw error;
  } finally {
    client.release();
  }
}
```

### Fact Table References Non-Existent Dimension

**Scenario:** An event references a category code, user_id, or tenant_id not yet present in the dimension tables.

**Resolution:** The ETL worker uses "ensure" methods that upsert dimension rows on first reference. This handles the case where dimension-populating events (e.g., `iam.user.created.v1`) arrive after the fact-populating events:

```typescript
private async ensureDimUser(userId: string, tenantId: string): Promise<void> {
  await this.db.query(`
    INSERT INTO analytics.dim_user (user_id, tenant_id, full_name, role_codes, region)
    VALUES ($1, $2, 'Unknown', '{}', null)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId, tenantId]);
  // The placeholder row will be updated when iam.user.created.v1 or iam.user.updated.v1 arrives
}

private async ensureDimCategory(code: string): Promise<void> {
  await this.db.query(`
    INSERT INTO analytics.dim_category (code, name, icon, color)
    VALUES ($1, $1, 'alert', '#424242')
    ON CONFLICT (code) DO NOTHING
  `, [code]);
}

private async ensureDimTenant(tenantId: string): Promise<void> {
  await this.db.query(`
    INSERT INTO analytics.dim_tenant (tenant_id, code, name)
    VALUES ($1, 'unknown', 'Unknown Tenant')
    ON CONFLICT (tenant_id) DO NOTHING
  `, [tenantId]);
}
```

### Post-Incident Report for Very Large Incident

**Scenario:** An incident has >1,000 timeline entries, hundreds of sitreps, and thousands of tasks.

**Resolution:** The report generator processes data in paginated chunks:

1. Timeline entries: fetched in pages of 500, each page appended to the report section
2. Tasks: aggregated in SQL (GROUP BY status, priority) rather than fetching individual rows
3. Sitreps: top 50 by severity included verbatim; remainder summarized as aggregate counts
4. Communication volume: pre-aggregated from `fact_message_volume` (already daily grain, no explosion)
5. PDF generation uses a streaming renderer to avoid loading the entire report into memory
6. Maximum report size: 50MB. If exceeded, the report is split into volumes (Part 1/N, Part 2/N, etc.)

```typescript
async generatePostIncidentReport(incidentId: string): Promise<Report> {
  const incident = await this.getFactIncident(incidentId);
  const report = new ReportBuilder(incident);

  // Tasks: aggregate, don't enumerate
  const taskAggregates = await this.db.query(`
    SELECT priority, breached, count(*), avg(delay_sec)
    FROM analytics.fact_task_sla
    WHERE incident_id = $1
    GROUP BY priority, breached
  `, [incidentId]);
  report.addTaskSection(taskAggregates.rows);

  // Sitreps: paginated
  let cursor: string | null = null;
  let sitrepPage = 0;
  do {
    const sitreps = await this.db.query(`
      SELECT * FROM analytics.fact_sitrep
      WHERE incident_id = $1 AND ($2::uuid IS NULL OR sitrep_id > $2)
      ORDER BY reported_at
      LIMIT 500
    `, [incidentId, cursor]);

    report.addSitrepPage(sitreps.rows, sitrepPage++);
    cursor = sitreps.rows.length === 500
      ? sitreps.rows[sitreps.rows.length - 1].sitrep_id
      : null;
  } while (cursor);

  // Communication volume
  const comms = await this.db.query(`
    SELECT date_key, sum(message_count), sum(unique_authors), sum(file_count)
    FROM analytics.fact_message_volume
    WHERE incident_id = $1
    GROUP BY date_key ORDER BY date_key
  `, [incidentId]);
  report.addCommunicationSection(comms.rows);

  return report.finalize();
}
```

### ETL Lag Exceeds 30 Seconds

**Scenario:** The analytics ETL consumer falls behind, and the lag between event timestamp and fact table write exceeds 30 seconds (p95 SLA).

**Resolution:**

1. The ETL worker continuously tracks the delta between `event.timestamp` and `now()` at processing time, reporting it as `analytics_etl_lag_seconds` Prometheus histogram
2. If p95 lag exceeds 30 seconds for 5 consecutive minutes, an alert fires
3. Remediation: scale ETL worker replicas horizontally (NATS JetStream supports competing consumers within the same consumer group)
4. Each additional worker processes a proportional share of the event stream partitions
5. Batch size and flush interval can be tuned dynamically via configuration: increase batch size to improve throughput at the cost of slightly higher latency

```typescript
// Lag tracking in the ETL worker
private trackLag(event: EventEnvelope<unknown>): void {
  const eventTime = new Date(event.timestamp).getTime();
  const lagMs = Date.now() - eventTime;
  this.metrics.histogram('analytics_etl_lag_seconds', lagMs / 1000, {
    event_type: event.type,
  });
}
```

### Redis Dedup Set Memory Pressure

**Scenario:** The Redis dedup SET grows large during high-throughput periods.

**Resolution:** The dedup mechanism uses a daily-rotated key pattern: `analytics:dedup:etl:{YYYY-MM-DD}`. Each day's set has a 48-hour TTL (24h active + 24h grace for late-arriving duplicates). This bounds the set size to approximately 2 days of event IDs. At 100 events/second, this is ~17M entries per day, consuming roughly 700MB of Redis memory. If memory pressure is a concern, switch to a Redis Bloom filter (`BF.ADD`/`BF.EXISTS`) with a configurable false positive rate of 0.01%.

### Concurrent Materialized View Refresh Fails Due to Missing Unique Index

**Scenario:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index on the view. If the index is corrupted or missing, the refresh fails.

**Resolution:** The refresh scheduler validates that the required unique index exists before attempting a concurrent refresh. If the index is missing, it falls back to a non-concurrent refresh (which briefly locks the view) and emits an alert for index reconstruction:

```typescript
async safeRefresh(viewName: string): Promise<void> {
  const hasUniqueIndex = await this.checkUniqueIndex(viewName);
  if (hasUniqueIndex) {
    await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.${viewName}`);
  } else {
    this.logger.error(`Missing unique index on ${viewName} — falling back to blocking refresh`);
    this.metrics.increment('analytics_mv_fallback_refresh_total', { view: viewName });
    await this.db.query(`REFRESH MATERIALIZED VIEW analytics.${viewName}`);
  }
}
```
