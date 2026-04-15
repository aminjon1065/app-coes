CREATE SCHEMA IF NOT EXISTS gis;

CREATE TABLE IF NOT EXISTS gis.layers (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  kind            text NOT NULL
                  CHECK (kind IN ('BASE', 'HAZARD', 'RESOURCE', 'ROUTE', 'INCIDENT', 'DRAW')),
  name            text NOT NULL,
  description     text,
  style           jsonb NOT NULL DEFAULT '{}',
  is_public       boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_layers_tenant
  ON gis.layers (tenant_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_layers_incident
  ON gis.layers (incident_id)
  WHERE incident_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gis.features (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  layer_id            uuid NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES iam.tenants(id),
  geometry            geometry(Geometry, 4326) NOT NULL,
  properties          jsonb NOT NULL DEFAULT '{}',
  label               text,
  linked_incident_id  uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  linked_task_id      uuid REFERENCES task.tasks(id) ON DELETE SET NULL,
  created_by          uuid NOT NULL REFERENCES iam.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_features_layer
  ON gis.features (layer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_geometry
  ON gis.features USING GIST (geometry)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_incident
  ON gis.features (linked_incident_id)
  WHERE linked_incident_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_gis_layers_updated_at
  BEFORE UPDATE ON gis.layers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_gis_features_updated_at
  BEFORE UPDATE ON gis.features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
