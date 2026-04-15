CREATE SCHEMA IF NOT EXISTS document;

CREATE TABLE IF NOT EXISTS document.documents (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id         uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  title               text NOT NULL,
  template_code       text NOT NULL,
  classification      smallint NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
  lifecycle_state     text NOT NULL DEFAULT 'DRAFT'
                      CHECK (
                        lifecycle_state IN (
                          'DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REVOKED'
                        )
                      ),
  current_version_id  uuid,
  created_by          uuid NOT NULL REFERENCES iam.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant
  ON document.documents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_documents_incident
  ON document.documents (incident_id)
  WHERE incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_state
  ON document.documents (lifecycle_state);

CREATE TABLE IF NOT EXISTS document.versions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id     uuid NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
  version_number  smallint NOT NULL,
  storage_bucket  text NOT NULL,
  storage_key     text NOT NULL,
  checksum_sha256 text NOT NULL,
  size_bytes      bigint NOT NULL,
  rendered_at     timestamptz,
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

ALTER TABLE document.documents
  DROP CONSTRAINT IF EXISTS fk_current_version;

ALTER TABLE document.documents
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id)
  REFERENCES document.versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS document.approvals (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id     uuid NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
  version_id      uuid NOT NULL REFERENCES document.versions(id) ON DELETE CASCADE,
  approver_id     uuid NOT NULL REFERENCES iam.users(id),
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  comment         text,
  signed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_id, approver_id)
);

CREATE OR REPLACE TRIGGER trg_document_documents_updated_at
  BEFORE UPDATE ON document.documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
