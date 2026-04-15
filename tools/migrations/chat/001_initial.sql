CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS chat.channels (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  type            text NOT NULL
                  CHECK (type IN ('DIRECT', 'GROUP', 'INCIDENT_ROOM', 'BROADCAST')),
  name            text,
  description     text,
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_channels_tenant
  ON chat.channels (tenant_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channels_incident
  ON chat.channels (incident_id)
  WHERE incident_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_incident_room
  ON chat.channels (incident_id)
  WHERE type = 'INCIDENT_ROOM';

CREATE TABLE IF NOT EXISTS chat.channel_members (
  channel_id      uuid NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  is_muted        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON chat.channel_members (user_id);

CREATE TABLE IF NOT EXISTS chat.messages (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id      uuid NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES iam.users(id),
  content         text,
  kind            text NOT NULL DEFAULT 'TEXT'
                  CHECK (kind IN ('TEXT', 'FILE', 'SYSTEM', 'SITREP', 'ESCALATION')),
  parent_id       uuid REFERENCES chat.messages(id),
  file_id         uuid,
  redacted_at     timestamptz,
  redacted_by     uuid REFERENCES iam.users(id),
  redact_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_channel
  ON chat.messages (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON chat.messages (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_content
  ON chat.messages USING GIN (to_tsvector('russian', COALESCE(content, '')))
  WHERE redacted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON chat.messages USING GIN (content gin_trgm_ops)
  WHERE redacted_at IS NULL AND content IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat.message_reactions (
  message_id      uuid NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  emoji           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE OR REPLACE TRIGGER trg_chat_channels_updated_at
  BEFORE UPDATE ON chat.channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_chat_messages_updated_at
  BEFORE UPDATE ON chat.messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
