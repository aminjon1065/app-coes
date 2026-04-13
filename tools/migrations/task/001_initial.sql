-- CoESCD - Task Schema Migration 001
-- Minimal task aggregate slice to support incident close-gate.

CREATE TABLE IF NOT EXISTS task.tasks (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 300),
  description     text CHECK (description IS NULL OR char_length(description) <= 10000),
  status          text NOT NULL DEFAULT 'todo' CHECK (
                    status IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled')
                  ),
  priority        smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  assignee_id     uuid REFERENCES iam.users(id),
  assigner_id     uuid NOT NULL REFERENCES iam.users(id),
  due_at          timestamptz,
  sla_breach_at   timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  parent_task_id  uuid REFERENCES task.tasks(id) ON DELETE SET NULL,
  position        integer NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_incident_status
  ON task.tasks(tenant_id, incident_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_incident_open
  ON task.tasks(incident_id, status)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON task.tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE task.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task.tasks;
CREATE POLICY tenant_isolation ON task.tasks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
