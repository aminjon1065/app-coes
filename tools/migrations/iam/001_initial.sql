-- CoESCD — IAM Schema Migration 001
-- Run after init.sql (extensions + schemas already created).
-- Idempotent: all statements use IF NOT EXISTS / OR REPLACE.

-- citext for case-insensitive email (init.sql doesn't include it)
CREATE EXTENSION IF NOT EXISTS "citext";

-- ── Tenants ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.tenants (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text UNIQUE NOT NULL,
  name            text NOT NULL,
  region          text,
  parent_id       uuid REFERENCES iam.tenants(id),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','archived')),
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON iam.tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.users (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  email           citext UNIQUE NOT NULL,
  phone           text,
  full_name       text NOT NULL,
  password_hash   text,
  clearance       smallint NOT NULL DEFAULT 1
                  CHECK (clearance BETWEEN 1 AND 4),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','locked','pending')),
  last_login_at   timestamptz,
  mfa_enabled     boolean NOT NULL DEFAULT false,
  attributes      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_users_tenant  ON iam.users(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON iam.users USING gin (email gin_trgm_ops);
CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON iam.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Roles ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.roles (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid REFERENCES iam.tenants(id),
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, code)
);

-- ── Permissions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.permissions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text UNIQUE NOT NULL,
  description     text
);

-- ── Role ↔ Permission ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.role_permissions (
  role_id         uuid REFERENCES iam.roles(id) ON DELETE CASCADE,
  permission_id   uuid REFERENCES iam.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ── User ↔ Role ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.user_roles (
  user_id         uuid REFERENCES iam.users(id) ON DELETE CASCADE,
  role_id         uuid REFERENCES iam.roles(id) ON DELETE CASCADE,
  scope           jsonb NOT NULL DEFAULT '{}',
  granted_by      uuid REFERENCES iam.users(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  PRIMARY KEY (user_id, role_id)
);

-- ── ABAC Policies ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.policies (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid REFERENCES iam.tenants(id),
  name            text NOT NULL,
  effect          text NOT NULL CHECK (effect IN ('allow','deny')),
  actions         text[] NOT NULL,
  resources       text[] NOT NULL,
  condition       jsonb NOT NULL DEFAULT '{}',
  priority        smallint NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Sessions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iam.sessions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  refresh_hash    text NOT NULL,
  user_agent      text,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON iam.sessions(user_id)
  WHERE revoked_at IS NULL;

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE iam.users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.sessions ENABLE ROW LEVEL SECURITY;

-- Tenant isolation (app sets SET LOCAL app.tenant_id = '...' per transaction)
-- Platform admins use a role that bypasses RLS.
DROP POLICY IF EXISTS tenant_isolation ON iam.users;
CREATE POLICY tenant_isolation ON iam.users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON iam.sessions;
CREATE POLICY tenant_isolation ON iam.sessions
  USING (user_id IN (
    SELECT id FROM iam.users
    WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));

-- ── Seed data (dev only) ──────────────────────────────────────────────────────
-- Creates the default HQ tenant and a platform_admin role.
-- Admin user is created by the app on first start via SEED_ADMIN_* env vars.
INSERT INTO iam.tenants (code, name, region, status)
VALUES ('tj-dushanbe', 'Dushanbe National HQ', 'TJ-DU', 'active')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.roles (tenant_id, code, name, is_system)
VALUES
  (NULL, 'platform_admin',       'Platform Administrator', true),
  (NULL, 'tenant_admin',         'Tenant Administrator',   true),
  (NULL, 'duty_operator',        'Duty Operator',          true),
  (NULL, 'shift_lead',           'Shift Supervisor',       true),
  (NULL, 'incident_commander',   'Incident Commander',     true),
  (NULL, 'field_responder',      'Field Responder',        true),
  (NULL, 'gis_analyst',          'GIS Analyst',            true),
  (NULL, 'agency_liaison',       'Inter-Agency Liaison',   true),
  (NULL, 'analyst',              'Analyst / Reporting',    true),
  (NULL, 'auditor',              'Auditor',                true)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO iam.permissions (code, description)
VALUES
  ('iam.profile.read', 'Read own IAM profile'),
  ('iam.profile.manage', 'Manage own IAM profile and MFA'),
  ('iam.users.create', 'Create users within tenant'),
  ('iam.users.read', 'Read users within tenant'),
  ('iam.users.delete', 'Delete users within tenant'),
  ('incident.read', 'View incidents'),
  ('incident.read.scoped', 'View incidents scoped to assignment'),
  ('incident.create', 'Create incidents'),
  ('incident.update.status', 'Transition incident status'),
  ('incident.update.severity', 'Update incident severity'),
  ('incident.assign.commander', 'Assign incident commander'),
  ('task.read', 'View tasks'),
  ('task.read.own', 'View own tasks'),
  ('task.create', 'Create tasks'),
  ('task.assign', 'Assign tasks'),
  ('task.update', 'Update any task'),
  ('task.update.own', 'Update own task'),
  ('sitrep.create', 'Submit situation report'),
  ('chat.read', 'Read chat channels'),
  ('chat.read.incident', 'Read incident chat channels'),
  ('chat.post', 'Post chat messages'),
  ('file.upload', 'Upload files'),
  ('document.read', 'Read documents'),
  ('document.create', 'Create documents'),
  ('document.approve.level1', 'Approve document at level 1'),
  ('document.approve.level2', 'Approve document at level 2'),
  ('call.start', 'Start calls'),
  ('call.record', 'Record calls'),
  ('gis.layer.create', 'Create GIS layers'),
  ('gis.layer.update', 'Update GIS layers'),
  ('gis.layer.publish', 'Publish GIS layers'),
  ('gis.feature.create', 'Create GIS features'),
  ('gis.feature.update', 'Update GIS features'),
  ('gis.feature.delete', 'Delete GIS features'),
  ('notification.read', 'Read notifications'),
  ('analytics.read', 'Read analytics'),
  ('analytics.export', 'Export analytics'),
  ('admin.user.manage', 'Manage users'),
  ('admin.role.manage', 'Manage roles'),
  ('admin.policy.manage', 'Manage policies'),
  ('audit.read', 'Read audit across tenants'),
  ('audit.read.own_tenant', 'Read audit in own tenant')
ON CONFLICT (code) DO NOTHING;

WITH role_permission_map(role_code, permission_code) AS (
  VALUES
    ('platform_admin', 'iam.profile.read'),
    ('platform_admin', 'iam.profile.manage'),
    ('platform_admin', 'iam.users.create'),
    ('platform_admin', 'iam.users.read'),
    ('platform_admin', 'iam.users.delete'),
    ('platform_admin', 'incident.read'),
    ('platform_admin', 'incident.read.scoped'),
    ('platform_admin', 'incident.create'),
    ('platform_admin', 'incident.update.status'),
    ('platform_admin', 'incident.update.severity'),
    ('platform_admin', 'incident.assign.commander'),
    ('platform_admin', 'task.read'),
    ('platform_admin', 'task.read.own'),
    ('platform_admin', 'task.create'),
    ('platform_admin', 'task.assign'),
    ('platform_admin', 'task.update'),
    ('platform_admin', 'task.update.own'),
    ('platform_admin', 'sitrep.create'),
    ('platform_admin', 'chat.read'),
    ('platform_admin', 'chat.read.incident'),
    ('platform_admin', 'chat.post'),
    ('platform_admin', 'file.upload'),
    ('platform_admin', 'document.read'),
    ('platform_admin', 'document.create'),
    ('platform_admin', 'document.approve.level1'),
    ('platform_admin', 'document.approve.level2'),
    ('platform_admin', 'call.start'),
    ('platform_admin', 'call.record'),
    ('platform_admin', 'gis.layer.create'),
    ('platform_admin', 'gis.layer.update'),
    ('platform_admin', 'gis.layer.publish'),
    ('platform_admin', 'gis.feature.create'),
    ('platform_admin', 'gis.feature.update'),
    ('platform_admin', 'gis.feature.delete'),
    ('platform_admin', 'notification.read'),
    ('platform_admin', 'analytics.read'),
    ('platform_admin', 'analytics.export'),
    ('platform_admin', 'admin.user.manage'),
    ('platform_admin', 'admin.role.manage'),
    ('platform_admin', 'admin.policy.manage'),
    ('platform_admin', 'audit.read'),
    ('platform_admin', 'audit.read.own_tenant'),

    ('tenant_admin', 'iam.profile.read'),
    ('tenant_admin', 'iam.profile.manage'),
    ('tenant_admin', 'iam.users.create'),
    ('tenant_admin', 'iam.users.read'),
    ('tenant_admin', 'iam.users.delete'),
    ('tenant_admin', 'incident.read'),
    ('tenant_admin', 'incident.create'),
    ('tenant_admin', 'incident.update.status'),
    ('tenant_admin', 'incident.update.severity'),
    ('tenant_admin', 'incident.assign.commander'),
    ('tenant_admin', 'task.read'),
    ('tenant_admin', 'task.create'),
    ('tenant_admin', 'task.assign'),
    ('tenant_admin', 'task.update'),
    ('tenant_admin', 'document.read'),
    ('tenant_admin', 'document.create'),
    ('tenant_admin', 'document.approve.level1'),
    ('tenant_admin', 'document.approve.level2'),
    ('tenant_admin', 'notification.read'),
    ('tenant_admin', 'admin.user.manage'),
    ('tenant_admin', 'admin.role.manage'),
    ('tenant_admin', 'admin.policy.manage'),
    ('tenant_admin', 'audit.read.own_tenant'),

    ('incident_commander', 'iam.profile.read'),
    ('incident_commander', 'iam.profile.manage'),
    ('incident_commander', 'incident.read'),
    ('incident_commander', 'incident.create'),
    ('incident_commander', 'incident.update.status'),
    ('incident_commander', 'incident.update.severity'),
    ('incident_commander', 'task.read'),
    ('incident_commander', 'task.create'),
    ('incident_commander', 'task.assign'),
    ('incident_commander', 'task.update'),
    ('incident_commander', 'document.read'),
    ('incident_commander', 'document.create'),
    ('incident_commander', 'document.approve.level1'),
    ('incident_commander', 'document.approve.level2'),
    ('incident_commander', 'call.start'),
    ('incident_commander', 'call.record'),
    ('incident_commander', 'notification.read'),

    ('shift_lead', 'iam.profile.read'),
    ('shift_lead', 'iam.profile.manage'),
    ('shift_lead', 'iam.users.read'),
    ('shift_lead', 'incident.read'),
    ('shift_lead', 'incident.create'),
    ('shift_lead', 'incident.update.status'),
    ('shift_lead', 'incident.update.severity'),
    ('shift_lead', 'incident.assign.commander'),
    ('shift_lead', 'task.read'),
    ('shift_lead', 'task.create'),
    ('shift_lead', 'task.assign'),
    ('shift_lead', 'document.read'),
    ('shift_lead', 'document.approve.level1'),
    ('shift_lead', 'notification.read'),

    ('duty_operator', 'iam.profile.read'),
    ('duty_operator', 'iam.profile.manage'),
    ('duty_operator', 'incident.read'),
    ('duty_operator', 'incident.create'),
    ('duty_operator', 'task.read'),
    ('duty_operator', 'sitrep.create'),
    ('duty_operator', 'chat.read.incident'),
    ('duty_operator', 'chat.post'),
    ('duty_operator', 'file.upload'),
    ('duty_operator', 'notification.read'),

    ('field_responder', 'iam.profile.read'),
    ('field_responder', 'iam.profile.manage'),
    ('field_responder', 'incident.read'),
    ('field_responder', 'task.read.own'),
    ('field_responder', 'task.update.own'),
    ('field_responder', 'sitrep.create'),
    ('field_responder', 'chat.post'),
    ('field_responder', 'file.upload'),
    ('field_responder', 'notification.read'),

    ('gis_analyst', 'iam.profile.read'),
    ('gis_analyst', 'iam.profile.manage'),
    ('gis_analyst', 'incident.read'),
    ('gis_analyst', 'gis.layer.create'),
    ('gis_analyst', 'gis.layer.update'),
    ('gis_analyst', 'gis.layer.publish'),
    ('gis_analyst', 'gis.feature.create'),
    ('gis_analyst', 'gis.feature.update'),
    ('gis_analyst', 'gis.feature.delete'),

    ('agency_liaison', 'iam.profile.read'),
    ('agency_liaison', 'iam.profile.manage'),
    ('agency_liaison', 'incident.read.scoped'),
    ('agency_liaison', 'task.read'),
    ('agency_liaison', 'document.read'),
    ('agency_liaison', 'chat.read.incident'),
    ('agency_liaison', 'chat.post'),

    ('analyst', 'iam.profile.read'),
    ('analyst', 'iam.profile.manage'),
    ('analyst', 'incident.read'),
    ('analyst', 'task.read'),
    ('analyst', 'document.read'),
    ('analyst', 'analytics.read'),
    ('analyst', 'analytics.export'),

    ('auditor', 'iam.profile.read'),
    ('auditor', 'iam.profile.manage'),
    ('auditor', 'incident.read'),
    ('auditor', 'task.read'),
    ('auditor', 'document.read'),
    ('auditor', 'chat.read'),
    ('auditor', 'audit.read')
)
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM role_permission_map rpm
JOIN iam.roles r
  ON r.code = rpm.role_code
 AND r.tenant_id IS NULL
JOIN iam.permissions p
  ON p.code = rpm.permission_code
ON CONFLICT DO NOTHING;
