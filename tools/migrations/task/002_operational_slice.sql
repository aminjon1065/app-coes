-- CoESCD - Task Schema Migration 002
-- Adds comments and assignment history for the operational task slice.

CREATE TABLE IF NOT EXISTS task.assignment_history (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  task_id       uuid NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES iam.tenants(id),
  assignee_id   uuid REFERENCES iam.users(id),
  assigned_by   uuid NOT NULL REFERENCES iam.users(id),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  assigned_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_history_task_assigned_at
  ON task.assignment_history(task_id, assigned_at DESC);

ALTER TABLE task.assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task.assignment_history;
CREATE POLICY tenant_isolation ON task.assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS task.comments (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  task_id       uuid NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES iam.tenants(id),
  author_id     uuid NOT NULL REFERENCES iam.users(id),
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_created_at
  ON task.comments(task_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER trg_task_comments_updated_at
  BEFORE UPDATE ON task.comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE task.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task.comments;
CREATE POLICY tenant_isolation ON task.comments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
