CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.events (
  id              uuid NOT NULL DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  actor_id        uuid,
  event_type      text NOT NULL,
  target_type     text,
  target_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  session_id      uuid,
  ts              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

CREATE TABLE IF NOT EXISTS audit.events_2026_04
  PARTITION OF audit.events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS audit.events_2026_05
  PARTITION OF audit.events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS audit.events_2026_06
  PARTITION OF audit.events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX IF NOT EXISTS idx_audit_tenant_ts
  ON audit.events (tenant_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor_ts
  ON audit.events (actor_id, ts DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_target
  ON audit.events (target_type, target_id)
  WHERE target_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coescd_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit.events FROM coescd_app';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coescd_auditor') THEN
    EXECUTE 'GRANT SELECT ON audit.events TO coescd_auditor';
  END IF;
END;
$$;
