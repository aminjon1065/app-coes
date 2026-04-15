CREATE SCHEMA IF NOT EXISTS file;

CREATE TABLE IF NOT EXISTS file.files (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL REFERENCES iam.tenants(id),
  original_name       text NOT NULL,
  content_type        text NOT NULL,
  size_bytes          bigint NOT NULL,
  storage_bucket      text NOT NULL,
  storage_key         text NOT NULL,
  checksum_sha256     text NOT NULL,
  scan_status         text NOT NULL DEFAULT 'PENDING'
                      CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'ERROR')),
  scan_result_detail  text,
  uploaded_by         uuid NOT NULL REFERENCES iam.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, checksum_sha256)
);

CREATE INDEX IF NOT EXISTS idx_files_tenant
  ON file.files (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_files_uploader
  ON file.files (uploaded_by);

CREATE TABLE IF NOT EXISTS file.variants (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  file_id         uuid NOT NULL REFERENCES file.files(id) ON DELETE CASCADE,
  variant_type    text NOT NULL CHECK (variant_type IN ('thumbnail', 'preview', 'ocr_text')),
  storage_bucket  text NOT NULL,
  storage_key     text NOT NULL,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, variant_type)
);
