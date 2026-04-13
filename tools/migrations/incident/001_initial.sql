-- CoESCD - Incident Schema Migration 001
-- Core incident aggregate for the first operational slice.

CREATE TABLE IF NOT EXISTS incident.incidents (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  code            text UNIQUE NOT NULL,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description     text CHECK (description IS NULL OR char_length(description) <= 5000),
  category        text NOT NULL CHECK (
                    category IN (
                      'earthquake','flood','fire','wildfire','industrial',
                      'cbrn','mass_gathering','medical','transport','other'
                    )
                  ),
  severity        smallint NOT NULL CHECK (severity BETWEEN 1 AND 4),
  status          text NOT NULL DEFAULT 'draft' CHECK (
                    status IN ('draft','open','escalated','contained','closed','archived')
                  ),
  classification  smallint NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
  commander_id    uuid REFERENCES iam.users(id),
  opened_at       timestamptz,
  closed_at       timestamptz,
  parent_id       uuid REFERENCES incident.incidents(id),
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status
  ON incident.incidents(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created_at
  ON incident.incidents(tenant_id, created_at DESC);

CREATE OR REPLACE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incident.incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS incident.participants (
  incident_id      uuid NOT NULL REFERENCES incident.incidents(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES iam.users(id),
  role_in_incident text NOT NULL CHECK (
                    role_in_incident IN (
                      'commander','deputy','liaison','observer','responder'
                    )
                  ),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  left_at          timestamptz,
  PRIMARY KEY (incident_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_user_id
  ON incident.participants(user_id);

CREATE INDEX IF NOT EXISTS idx_participants_active
  ON incident.participants(incident_id)
  WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS incident.sitreps (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  incident_id     uuid NOT NULL REFERENCES incident.incidents(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  reporter_id     uuid NOT NULL REFERENCES iam.users(id),
  severity        smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 4),
  text            text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 10000),
  attachments     jsonb NOT NULL DEFAULT '[]',
  location        jsonb,
  reported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sitreps_incident_reported_at
  ON incident.sitreps(incident_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_sitreps_tenant_id
  ON incident.sitreps(tenant_id);

CREATE TABLE IF NOT EXISTS incident.timeline (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  incident_id     uuid NOT NULL REFERENCES incident.incidents(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  ts              timestamptz NOT NULL DEFAULT now(),
  kind            text NOT NULL CHECK (
                    kind IN (
                      'status_change','severity_change','assignment','sitrep',
                      'document','note','participant_joined','participant_left',
                      'geofence_update','epicenter_update','escalation',
                      'classification_change','commander_assigned',
                      'resource_deployed','resource_returned'
                    )
                  ),
  actor_id        uuid NOT NULL REFERENCES iam.users(id),
  payload         jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_timeline_incident_ts
  ON incident.timeline(incident_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_timeline_tenant_id
  ON incident.timeline(tenant_id);

CREATE INDEX IF NOT EXISTS idx_timeline_kind
  ON incident.timeline(incident_id, kind);

ALTER TABLE incident.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.sitreps ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON incident.incidents;
CREATE POLICY tenant_isolation ON incident.incidents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON incident.timeline;
CREATE POLICY tenant_isolation ON incident.timeline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON incident.sitreps;
CREATE POLICY tenant_isolation ON incident.sitreps
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON incident.participants;
CREATE POLICY tenant_isolation ON incident.participants
  USING (
    EXISTS (
      SELECT 1
      FROM incident.incidents i
      WHERE i.id = incident_id
        AND i.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );
