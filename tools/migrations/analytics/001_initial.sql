CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.fact_incidents (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL,
  incident_id         uuid NOT NULL UNIQUE,
  opened_at           timestamptz NOT NULL,
  closed_at           timestamptz,
  duration_minutes    integer,
  category            text,
  severity_peak       smallint,
  status_final        text,
  tasks_total         integer NOT NULL DEFAULT 0,
  tasks_done          integer NOT NULL DEFAULT 0,
  tasks_breached_sla  integer NOT NULL DEFAULT 0,
  participants_count  integer NOT NULL DEFAULT 0,
  sitreps_count       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fact_incidents_tenant
  ON analytics.fact_incidents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_fact_incidents_opened
  ON analytics.fact_incidents (opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_fact_incidents_category
  ON analytics.fact_incidents (category);

CREATE TABLE IF NOT EXISTS analytics.fact_tasks (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id                uuid NOT NULL,
  task_id                  uuid NOT NULL UNIQUE,
  incident_id              uuid,
  priority                 smallint,
  status_final             text,
  time_to_start_minutes    integer,
  time_to_complete_minutes integer,
  sla_breached             boolean NOT NULL DEFAULT false,
  assignee_id              uuid,
  created_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_tasks_tenant
  ON analytics.fact_tasks (tenant_id);

CREATE INDEX IF NOT EXISTS idx_fact_tasks_incident
  ON analytics.fact_tasks (incident_id)
  WHERE incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fact_tasks_created
  ON analytics.fact_tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS analytics.dim_date (
  date_key    date PRIMARY KEY,
  year        smallint NOT NULL,
  quarter     smallint NOT NULL,
  month       smallint NOT NULL,
  week        smallint NOT NULL,
  day_of_week smallint NOT NULL,
  is_weekend  boolean NOT NULL
);

INSERT INTO analytics.dim_date
SELECT
  d::date,
  EXTRACT(year FROM d)::smallint,
  EXTRACT(quarter FROM d)::smallint,
  EXTRACT(month FROM d)::smallint,
  EXTRACT(week FROM d)::smallint,
  EXTRACT(dow FROM d)::smallint,
  EXTRACT(dow FROM d) IN (0, 6)
FROM generate_series('2025-01-01'::date, '2030-12-31'::date, '1 day'::interval) d
ON CONFLICT (date_key) DO NOTHING;
