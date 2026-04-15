CREATE SCHEMA IF NOT EXISTS notif;

CREATE TABLE IF NOT EXISTS notif.notifications (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  event_type      text NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  link            text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notif.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notif_tenant_created
  ON notif.notifications(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notif.notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES iam.users(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES iam.tenants(id),
  is_disabled       boolean NOT NULL DEFAULT false,
  email_enabled     boolean NOT NULL DEFAULT true,
  push_enabled      boolean NOT NULL DEFAULT false,
  in_app_enabled    boolean NOT NULL DEFAULT true,
  event_overrides   jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_preferences_tenant
  ON notif.notification_preferences(tenant_id);

CREATE OR REPLACE TRIGGER trg_notif_preferences_updated_at
  BEFORE UPDATE ON notif.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
