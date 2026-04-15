# CoESCD — Detailed Implementation Plan
## National Disaster Management Platform

> **Status:** Implementation-ready. Every section is binding.
> **Source of truth:** `BIG_PLAN.md` (domain spec) + this file (build order).
> **Working directory:** `/app-coes`

---

## Table of Contents

1. [Current State Snapshot](#1-current-state-snapshot)
2. [Architecture Reference](#2-architecture-reference)
3. [Phase 1 — Stabilize & Complete Core](#3-phase-1--stabilize--complete-core)
4. [Phase 2 — Frontend: Missing UI Surfaces](#4-phase-2--frontend-missing-ui-surfaces)
5. [Phase 3 — Advanced Features](#5-phase-3--advanced-features)
6. [Phase 4 — Infrastructure & Production Hardening](#6-phase-4--infrastructure--production-hardening)
7. [Sprint Schedule](#7-sprint-schedule)
8. [Critical Technical Rules](#8-critical-technical-rules)

---

## 1. Current State Snapshot

### What is Done

| Area | Files | Status |
|---|---|---|
| PostgreSQL schema (IAM, Incident, Task) | `tools/migrations/` | ✅ Done |
| Docker Compose dev stack (15 services) | `infra/docker/docker-compose.yml` | ✅ Done |
| NestJS modular monolith skeleton | `backend/src/` | ✅ Done |
| IAM module (auth, JWT, RBAC guards) | `backend/src/modules/iam/` | ✅ Done |
| Incident REST API (CRUD, participants, sitreps) | `backend/src/modules/incident/` | ✅ Done |
| Task REST API (board, status machine, comments) | `backend/src/modules/task/` | ✅ Done |
| SSE realtime infrastructure (backend) | `backend/src/shared/events/realtime-events.service.ts` | ✅ Done |
| SSE streaming endpoints | `incidents.controller.ts`, `tasks.controller.ts` | ✅ Done |
| Next.js SSE proxy routes | `frontend/app/api/incidents/[id]/stream/`, `frontend/app/api/tasks/stream/` | ✅ Done |
| Task board UI (drag-drop, Kanban columns) | `frontend/components/task/task-status-board.tsx` | ✅ Done |
| Task workspace live shell (SSE client) | `frontend/components/task/task-workspace-live-shell.tsx` | ✅ Done |
| Incident detail page (overview + tasks tabs) | `frontend/app/(app)/incidents/[id]/page.tsx` | ✅ Done |
| Incident activity feed (realtime) | `frontend/components/incident/incident-activity-feed.tsx` | ✅ Done |
| Live toast provider | `frontend/components/ui/live-toast-provider.tsx` | ✅ Done |
| Realtime event utilities | `frontend/lib/realtime.ts` | ✅ Done |

### What is Missing

| Area | Backend | Frontend |
|---|---|---|
| File upload pipeline (MinIO + ClamAV) | ✅ Done | ❌ Not started |
| Chat / messaging | ✅ Done | ❌ Not started |
| GIS / map workspace | ✅ Done | ❌ Not started |
| Document workflow | ✅ Done | ❌ Not started |
| Notification engine | ✅ Done | ❌ Not started |
| Audit trail | ✅ Done | ❌ Not started |
| Analytics | ✅ Done | ❌ Not started |
| Admin panel | partial | partial |
| Incident timeline UI | done (entity) | partial |
| Sitrep UI (mobile-friendly) | done (entity) | partial |
| WebRTC call system | ❌ Not started | ❌ Not started |
| Mobile PWA | — | ❌ Not started |
| Inter-agency liaison | partial (RBAC) | ❌ Not started |
| Docker builds (backend + frontend) | ❌ No Dockerfile | ❌ No Dockerfile |
| Nginx reverse proxy | ❌ Not started | — |
| Production docker-compose | ❌ Not started | — |
| Observability dashboards | configs ready | — |
| MFA (TOTP) flow | ❌ Incomplete | ❌ Incomplete |
| Break-glass access | ❌ Not started | ❌ Not started |

---

## 2. Architecture Reference

### 2.1 Stack Summary

| Layer | Technology | Version |
|---|---|---|
| API framework | NestJS (modular monolith) | 11.x |
| Frontend | Next.js App Router | 16.x |
| Database | PostgreSQL + PostGIS | 17 + 3.5 |
| Connection pooler | PgBouncer (transaction mode) | latest |
| Cache / sessions | Redis | 7.4 |
| Message broker | NATS JetStream | 2.10 |
| Object storage | MinIO (S3-compatible) | latest |
| Search | OpenSearch | 2.17 |
| Antivirus | ClamAV | 1.4 |
| Realtime (frontend↔backend) | SSE (primary), Socket.IO (chat/calls) | — |
| WebRTC SFU | mediasoup | 3.x |
| ORM | TypeORM | 0.3 |
| Auth | JWT (HS256 dev / RS256 prod), Argon2id | — |
| Observability | Prometheus + Grafana + Jaeger + Loki | — |

### 2.2 Port Map

| Service | Port |
|---|---|
| Frontend (Next.js) | 3000 |
| Backend API (NestJS) | 3001 |
| Realtime gateway | 3002 |
| mediasoup SFU | 3003 |
| Worker processes | 3004 |
| PostgreSQL (direct) | 5432 |
| PgBouncer | 6432 |
| Redis | 6379 |
| NATS | 4222 / 8222 (monitor) |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| OpenSearch | 9200 |
| OpenSearch Dashboards | 5601 |
| Mailpit UI | 8025 |
| Prometheus | 9090 |
| Grafana | 3500 |
| Jaeger UI | 16686 |

### 2.3 Bounded Context Boundaries

No cross-context DB joins in application code. Cross-context reads use projected read models populated via domain events.

| Context | Schema prefix | Communicates via |
|---|---|---|
| IAM | `iam.*` | REST + events |
| Incident | `incident.*` | REST + events |
| Task | `task.*` | REST + events |
| Chat | `chat.*` | WebSocket + events |
| Document | `doc.*` | REST + events |
| GIS | `gis.*` | REST + events |
| File | `file.*` | REST + events |
| Notification | `notif.*` | events (write) |
| Audit | `audit.*` | events only (append-only) |
| Analytics | `analytics.*` | events (subscribe-only) |

### 2.4 Realtime Architecture

```
Backend domain event (EventEmitter2)
  → RealtimeEventsService.listener()
    → filters by tenantId / incidentId / taskId
      → RxJS Observable<MessageEvent>
        → NestJS @Sse endpoint (text/event-stream)
          → Next.js API proxy route (forwards cookies→JWT)
            → Browser EventSource
              → parse JSON → toast + highlight + re-fetch
```

For chat and calls, Socket.IO is used instead of SSE (bidirectional required):

```
Browser Socket.IO client
  → NestJS ChatGateway / CallGateway
    → Redis adapter (fan-out across instances)
      → All connected clients in room
```

---

## 3. Phase 1 — Stabilize & Complete Core

### Step 1 — Complete Database Migrations

**Status:** ✅ Completed

**New files to create:**

```
tools/migrations/
├── incident/
│   └── 002_gis_fields.sql
├── chat/
│   └── 001_initial.sql
├── document/
│   └── 001_initial.sql
├── gis/
│   └── 001_initial.sql
├── file/
│   └── 001_initial.sql
├── audit/
│   └── 001_initial.sql
└── analytics/
    └── 001_initial.sql
```

---

#### 1a. Add PostGIS geometry to incidents

File: `tools/migrations/incident/002_gis_fields.sql`

```sql
ALTER TABLE incident.incidents
  ADD COLUMN IF NOT EXISTS geofence geometry(Geometry, 4326),
  ADD COLUMN IF NOT EXISTS epicenter geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_incidents_geofence
  ON incident.incidents USING GIST(geofence)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_epicenter
  ON incident.incidents USING GIST(epicenter)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN incident.incidents.geofence IS
  'Operational area polygon in EPSG:4326. Set by IC or GIS analyst.';
COMMENT ON COLUMN incident.incidents.epicenter IS
  'Single point of origin (earthquake, explosion, etc.).';
```

---

#### 1b. Chat schema

File: `tools/migrations/chat/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE chat.channels (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  type            text NOT NULL
                  CHECK (type IN ('DIRECT','GROUP','INCIDENT_ROOM','BROADCAST')),
  name            text,
  description     text,
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_channels_tenant     ON chat.channels(tenant_id) WHERE archived_at IS NULL;
CREATE INDEX idx_channels_incident   ON chat.channels(incident_id) WHERE incident_id IS NOT NULL;
CREATE UNIQUE INDEX idx_channels_incident_room
  ON chat.channels(incident_id) WHERE type = 'INCIDENT_ROOM';

CREATE TABLE chat.channel_members (
  channel_id      uuid NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  is_muted        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON chat.channel_members(user_id);

CREATE TABLE chat.messages (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id      uuid NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES iam.users(id),
  content         text,
  kind            text NOT NULL DEFAULT 'TEXT'
                  CHECK (kind IN ('TEXT','FILE','SYSTEM','SITREP','ESCALATION')),
  parent_id       uuid REFERENCES chat.messages(id),   -- thread reply
  file_id         uuid,                                  -- FK to file.files after file module
  redacted_at     timestamptz,
  redacted_by     uuid REFERENCES iam.users(id),
  redact_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_messages_channel    ON chat.messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_parent     ON chat.messages(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_messages_content    ON chat.messages USING gin(to_tsvector('russian', content))
  WHERE redacted_at IS NULL;
CREATE INDEX idx_messages_content_trgm ON chat.messages USING gin(content gin_trgm_ops)
  WHERE redacted_at IS NULL;

CREATE TABLE chat.message_reactions (
  message_id      uuid NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  emoji           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
```

---

#### 1c. Document schema

File: `tools/migrations/document/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS document;

CREATE TABLE document.documents (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id         uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  title               text NOT NULL,
  template_code       text NOT NULL,
  classification      smallint NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
  lifecycle_state     text NOT NULL DEFAULT 'DRAFT'
                      CHECK (lifecycle_state IN
                        ('DRAFT','REVIEW','APPROVED','PUBLISHED','ARCHIVED','REVOKED')),
  current_version_id  uuid,   -- FK set after first version insert
  created_by          uuid NOT NULL REFERENCES iam.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_documents_tenant    ON document.documents(tenant_id);
CREATE INDEX idx_documents_incident  ON document.documents(incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_documents_state     ON document.documents(lifecycle_state);

CREATE TABLE document.versions (
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

-- Set FK for current_version_id after versions table exists
ALTER TABLE document.documents
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES document.versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE document.approvals (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id     uuid NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
  version_id      uuid NOT NULL REFERENCES document.versions(id) ON DELETE CASCADE,
  approver_id     uuid NOT NULL REFERENCES iam.users(id),
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  comment         text,
  signed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_id, approver_id)
);
```

---

#### 1d. GIS schema

File: `tools/migrations/gis/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS gis;

CREATE TABLE gis.layers (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE SET NULL,
  kind            text NOT NULL
                  CHECK (kind IN ('BASE','HAZARD','RESOURCE','ROUTE','INCIDENT','DRAW')),
  name            text NOT NULL,
  description     text,
  style           jsonb NOT NULL DEFAULT '{}',
  is_public       boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX idx_layers_tenant   ON gis.layers(tenant_id) WHERE archived_at IS NULL;
CREATE INDEX idx_layers_incident ON gis.layers(incident_id) WHERE incident_id IS NOT NULL;

CREATE TABLE gis.features (
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

CREATE INDEX idx_features_layer    ON gis.features(layer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_features_geometry ON gis.features USING GIST(geometry) WHERE deleted_at IS NULL;
CREATE INDEX idx_features_incident ON gis.features(linked_incident_id) WHERE linked_incident_id IS NOT NULL;
```

---

#### 1e. File schema

File: `tools/migrations/file/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS file;

CREATE TABLE file.files (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL REFERENCES iam.tenants(id),
  original_name       text NOT NULL,
  content_type        text NOT NULL,
  size_bytes          bigint NOT NULL,
  storage_bucket      text NOT NULL,
  storage_key         text NOT NULL,
  checksum_sha256     text NOT NULL,
  scan_status         text NOT NULL DEFAULT 'PENDING'
                      CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','ERROR')),
  scan_result_detail  text,
  uploaded_by         uuid NOT NULL REFERENCES iam.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, checksum_sha256)  -- deduplicate uploads within tenant
);

CREATE INDEX idx_files_tenant   ON file.files(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_uploader ON file.files(uploaded_by);

CREATE TABLE file.variants (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  file_id         uuid NOT NULL REFERENCES file.files(id) ON DELETE CASCADE,
  variant_type    text NOT NULL CHECK (variant_type IN ('thumbnail','preview','ocr_text')),
  storage_bucket  text NOT NULL,
  storage_key     text NOT NULL,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, variant_type)
);
```

---

#### 1f. Audit schema (append-only, partitioned)

File: `tools/migrations/audit/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS audit;

-- Parent partitioned table; never INSERT directly — always through audit.events_YYYY_MM
CREATE TABLE audit.events (
  id              uuid NOT NULL DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  actor_id        uuid,                -- null for system actions
  event_type      text NOT NULL,       -- e.g. 'incident.status_changed.v1'
  target_type     text,                -- e.g. 'incident'
  target_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  session_id      uuid,
  ts              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- Create partitions for current and next 3 months; add new ones monthly via cron
CREATE TABLE audit.events_2026_04 PARTITION OF audit.events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit.events_2026_05 PARTITION OF audit.events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit.events_2026_06 PARTITION OF audit.events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Index per partition for fast filtering
CREATE INDEX idx_audit_tenant_ts    ON audit.events(tenant_id, ts DESC);
CREATE INDEX idx_audit_actor_ts     ON audit.events(actor_id, ts DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_target       ON audit.events(target_type, target_id) WHERE target_id IS NOT NULL;

-- Lock down permissions: app role may only INSERT, never UPDATE or DELETE
REVOKE UPDATE, DELETE, TRUNCATE ON audit.events FROM coescd_app;
-- Auditor role can SELECT only
GRANT SELECT ON audit.events TO coescd_auditor;
```

---

#### 1g. Analytics schema (denormalized read-side)

File: `tools/migrations/analytics/001_initial.sql`

```sql
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE analytics.fact_incidents (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL,
  incident_id         uuid NOT NULL UNIQUE,
  opened_at           timestamptz NOT NULL,
  closed_at           timestamptz,
  duration_minutes    integer,
  category            text,
  severity_peak       smallint,
  status_final        text,
  tasks_total         integer NOT NULL DEFAULT 0,
  tasks_done          integer NOT NULL DEFAULT 0,
  tasks_breached_sla  integer NOT NULL DEFAULT 0,
  participants_count  integer NOT NULL DEFAULT 0,
  sitreps_count       integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_fact_incidents_tenant   ON analytics.fact_incidents(tenant_id);
CREATE INDEX idx_fact_incidents_opened   ON analytics.fact_incidents(opened_at DESC);
CREATE INDEX idx_fact_incidents_category ON analytics.fact_incidents(category);

CREATE TABLE analytics.fact_tasks (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id               uuid NOT NULL,
  task_id                 uuid NOT NULL UNIQUE,
  incident_id             uuid,
  priority                smallint,
  status_final            text,
  time_to_start_minutes   integer,
  time_to_complete_minutes integer,
  sla_breached            boolean NOT NULL DEFAULT false,
  assignee_id             uuid,
  created_at              timestamptz NOT NULL
);

CREATE INDEX idx_fact_tasks_tenant   ON analytics.fact_tasks(tenant_id);
CREATE INDEX idx_fact_tasks_incident ON analytics.fact_tasks(incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_fact_tasks_created  ON analytics.fact_tasks(created_at DESC);

CREATE TABLE analytics.dim_date (
  date_key    date PRIMARY KEY,
  year        smallint NOT NULL,
  quarter     smallint NOT NULL,
  month       smallint NOT NULL,
  week        smallint NOT NULL,
  day_of_week smallint NOT NULL,
  is_weekend  boolean NOT NULL
);

-- Pre-populate dim_date for 5 years
INSERT INTO analytics.dim_date
SELECT
  d::date,
  EXTRACT(year FROM d)::smallint,
  EXTRACT(quarter FROM d)::smallint,
  EXTRACT(month FROM d)::smallint,
  EXTRACT(week FROM d)::smallint,
  EXTRACT(dow FROM d)::smallint,
  EXTRACT(dow FROM d) IN (0, 6)
FROM generate_series('2025-01-01'::date, '2030-12-31'::date, '1 day'::interval) d;
```

---

### Step 2 — Backend: File Upload Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/file/`

**New files:**

```
backend/src/modules/file/
├── file.module.ts
├── entities/
│   ├── file.entity.ts
│   └── file-variant.entity.ts
├── controllers/
│   └── file.controller.ts
├── services/
│   ├── file.service.ts
│   ├── minio.service.ts
│   └── file-scan.service.ts
└── dto/
    └── upload-file.dto.ts
```

#### `file.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity, FileVariantEntity])],
  providers: [FileService, MinioService, FileScanService],
  controllers: [FileController],
  exports: [FileService, MinioService],
})
export class FileModule {}
```

#### `minio.service.ts`

- Inject `ConfigService` for `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
- Initialize `new Minio.Client(...)` in `onModuleInit()`
- Method `putObject(bucket, key, stream, size, contentType): Promise<void>`
- Method `presignedGetUrl(bucket, key, ttlSeconds = 3600): Promise<string>` — never expose raw storage paths to the client
- Method `removeObject(bucket, key): Promise<void>`
- Buckets used: `coescd-dev-files` (uploads), `coescd-dev-documents` (PDFs), `coescd-dev-media` (images/video)

#### `file-scan.service.ts`

- TCP connection to ClamAV on `CLAMD_HOST:3310`
- Method `scan(buffer: Buffer): Promise<'CLEAN' | 'INFECTED' | 'ERROR'>`
- Uses `INSTREAM` ClamAV protocol: chunk buffer over TCP, read response
- Timeout: 30s; on timeout return `'ERROR'` and log

#### `file.service.ts`

```typescript
async upload(file: Express.Multer.File, userId: string, tenantId: string): Promise<FileEntity> {
  // 1. Compute SHA-256 checksum
  // 2. Check for duplicate: SELECT * FROM file.files WHERE tenant_id=$1 AND checksum_sha256=$2
  //    If found: return existing record (deduplication)
  // 3. AV scan via FileScanService.scan(file.buffer)
  //    If INFECTED: throw ForbiddenException, emit file.scan_failed event
  // 4. Upload to MinIO: bucket=coescd-dev-files, key=tenantId/YYYY/MM/uuid.ext
  // 5. INSERT into file.files with scan_status='CLEAN'
  // 6. Emit file.uploaded.v1 event
  // 7. If image: queue thumbnail generation (async, do not await)
  // 8. Return entity
}

async getPresignedUrl(fileId: string, userId: string): Promise<string> {
  // 1. Load file entity, verify classification vs user clearance
  // 2. Call MinioService.presignedGetUrl(bucket, key, 3600)
  // 3. Return URL (never return raw storage path)
}
```

#### `file.controller.ts`

```typescript
@Post('upload')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 500 * 1024 * 1024 },  // 500 MB
  fileFilter: (req, file, cb) => {
    // Block executable extensions at controller level
    const blocked = ['.exe', '.bat', '.sh', '.ps1', '.cmd'];
    if (blocked.some(ext => file.originalname.toLowerCase().endsWith(ext))) {
      return cb(new BadRequestException('File type not allowed'), false);
    }
    cb(null, true);
  },
}))
async uploadFile(@UploadedFile() file: Express.Multer.File, @Req() req) {
  return this.fileService.upload(file, req.user.id, req.user.tenantId);
}

@Get(':id/url')
async getDownloadUrl(@Param('id') id: string, @Req() req) {
  return { url: await this.fileService.getPresignedUrl(id, req.user.id) };
}

@Delete(':id')
@HttpCode(204)
async deleteFile(@Param('id') id: string, @Req() req) {
  await this.fileService.softDelete(id, req.user.id);
}
```

**Register in `app.module.ts`:**
```typescript
imports: [..., FileModule]
```

---

### Step 3 — Backend: Chat Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/chat/`

**New files:**

```
backend/src/modules/chat/
├── chat.module.ts
├── entities/
│   ├── channel.entity.ts
│   ├── channel-member.entity.ts
│   └── message.entity.ts
├── controllers/
│   └── channels.controller.ts
├── gateways/
│   └── chat.gateway.ts
├── services/
│   ├── channel.service.ts
│   └── message.service.ts
├── listeners/
│   └── chat-incident.listener.ts
└── dto/
    ├── create-channel.dto.ts
    ├── send-message.dto.ts
    └── update-channel.dto.ts
```

#### REST Endpoints (`channels.controller.ts`)

| Method | Path | Guard | Description |
|---|---|---|---|
| `GET` | `/channels` | JWT | List channels accessible to current user |
| `POST` | `/channels` | JWT + `chat.channel.create` | Create GROUP or DIRECT channel |
| `GET` | `/channels/:id` | JWT + member | Get channel metadata |
| `GET` | `/channels/:id/messages` | JWT + member | Paginated history (cursor `?before=msgId&limit=50`) |
| `POST` | `/channels/:id/messages` | JWT + member | Send message |
| `PATCH` | `/channels/:id/messages/:msgId/redact` | JWT + permission | Soft-redact with audit reason |
| `POST` | `/channels/:id/members` | JWT + coordinator | Add member |
| `DELETE` | `/channels/:id/members/:userId` | JWT + coordinator | Remove member |
| `POST` | `/channels/:id/reactions/:msgId` | JWT + member | Add emoji reaction |
| `DELETE` | `/channels/:id/reactions/:msgId/:emoji` | JWT + member | Remove reaction |

#### WebSocket Gateway (`chat.gateway.ts`)

```typescript
@WebSocketGateway({ namespace: '/chat', cors: { origin: process.env.FRONTEND_URL } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // On connection: extract JWT from handshake.auth.token
  //   → validate → attach user to socket.data
  //   → join rooms: user:{userId}, tenant:{tenantId}
  //   → join all channels user is a member of: channel:{channelId}

  @SubscribeMessage('join_channel')
  handleJoin(client: Socket, channelId: string) {
    // Verify membership, then client.join(`channel:${channelId}`)
  }

  @SubscribeMessage('typing_start')
  handleTyping(client: Socket, channelId: string) {
    // Broadcast to channel room excluding sender: typing.start { userId, channelId }
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(client: Socket, channelId: string) { ... }
}
```

**Emit from `message.service.ts` after INSERT:**
```typescript
this.chatGateway.server
  .to(`channel:${message.channelId}`)
  .emit('message.new', message);
```

#### Auto-create incident room (`chat-incident.listener.ts`)

```typescript
@OnEvent('incident.status_changed')
async onIncidentStatusChanged(event: IncidentStatusChangedEvent) {
  if (event.newStatus !== 'open') return;

  const existing = await this.channelRepo.findOne({
    where: { incidentId: event.incidentId, type: 'INCIDENT_ROOM' },
  });
  if (existing) return;  // idempotent

  const channel = await this.channelService.create({
    tenantId: event.tenantId,
    incidentId: event.incidentId,
    type: 'INCIDENT_ROOM',
    name: `Incident Room — ${event.incidentCode}`,
    createdBy: event.actorId,
  });

  // Add all current incident participants as channel members
  const participants = await this.incidentParticipantRepo.find({
    where: { incidentId: event.incidentId },
  });
  for (const p of participants) {
    await this.channelService.addMember(channel.id, p.userId);
  }
}
```

**Socket.IO Redis adapter setup in `chat.module.ts`:**
```typescript
// Needed for multi-instance: all gateway instances share Redis pub/sub
import { createAdapter } from '@socket.io/redis-adapter';

// In ChatGateway.afterInit(server):
const pubClient = this.redisService.getClient();
const subClient = pubClient.duplicate();
server.adapter(createAdapter(pubClient, subClient));
```

---

### Step 4 — Backend: Notification Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/notification/`

**New files:**

```
backend/src/modules/notification/
├── notification.module.ts
├── entities/
│   ├── notification.entity.ts
│   └── notification-preference.entity.ts
├── services/
│   ├── notification.service.ts
│   ├── email.service.ts
│   └── in-app.service.ts
├── listeners/
│   └── notification.listener.ts
└── controllers/
    └── notification.controller.ts
```

**Add table** (`tools/migrations/notification/001_initial.sql`):

```sql
CREATE SCHEMA IF NOT EXISTS notif;

CREATE TABLE notif.notifications (
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

CREATE INDEX idx_notif_user_unread ON notif.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
```

#### `notification.listener.ts`

```typescript
// Subscribes to all incident + task + iam events
@OnEvent('incident.*', { async: true })
async onIncidentEvent(event: any) {
  // Map event type to notification title/body
  // Fetch all incident participants
  // For each participant: create notification record
  // Emit in-app via ChatGateway room user:{userId}
  // If email preference enabled: queue email
}

@OnEvent('task.*', { async: true })
async onTaskEvent(event: any) {
  // Notify assignee on: task.assigned, task.sla_breached, task.commented
}
```

**Idempotency:** Store `event_id` in `metadata`; skip if already processed.

**CRITICAL severity bypass:**
```typescript
// In notification.service.ts:
if (event.severity === 'CRITICAL') {
  // Ignore user.notification_preferences.is_disabled
  // Always deliver to all participants
}
```

#### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/notifications` | List unread notifications for current user (paginated) |
| `PATCH` | `/notifications/:id/read` | Mark as read |
| `PATCH` | `/notifications/read-all` | Mark all as read |
| `GET` | `/notifications/preferences` | Get notification preferences |
| `PATCH` | `/notifications/preferences` | Update preferences (email, push, in-app per event type) |

---

### Step 5 — Backend: Audit Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/audit/`

**New files:**

```
backend/src/modules/audit/
├── audit.module.ts
├── entities/
│   └── audit-event.entity.ts
├── services/
│   └── audit.service.ts
├── listeners/
│   └── audit.listener.ts
└── controllers/
    └── audit.controller.ts
```

#### `audit.listener.ts`

```typescript
// Wildcard listener: catches ALL domain events
@OnEvent('**', { async: true })
async onAnyEvent(event: BaseEvent) {
  // Skip internal/non-auditable events (heartbeat, etc.)
  if (!event?.eventId || !event?.tenantId) return;

  await this.auditService.record({
    tenantId: event.tenantId,
    actorId: event.actorId,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    before: event.before,
    after: event.after,
    ip: event.ip,
    userAgent: event.userAgent,
    sessionId: event.sessionId,
  });
}
```

#### `audit.service.ts`

```typescript
async record(data: CreateAuditEventDto): Promise<void> {
  // INSERT only — no UPDATE, no DELETE, no upsert
  await this.auditRepo.insert({ ...data, ts: new Date() });
  // Do NOT emit events from audit service (would create infinite loop)
}
```

#### REST Endpoints (`audit.controller.ts`)

All endpoints require `auditor` or `platform_admin` role.

| Method | Path | Query Params | Description |
|---|---|---|---|
| `GET` | `/audit` | `actorId`, `eventType`, `targetType`, `targetId`, `from`, `to`, `cursor`, `limit` | Paginated audit log |
| `GET` | `/audit/:id` | — | Single event detail with before/after |
| `GET` | `/audit/export` | `format=csv` | Download CSV export |

---

### Step 6 — Backend: GIS Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/gis/`

**New files:**

```
backend/src/modules/gis/
├── gis.module.ts
├── entities/
│   ├── map-layer.entity.ts
│   └── map-feature.entity.ts
├── controllers/
│   └── gis.controller.ts
└── services/
    └── gis.service.ts
```

#### TypeORM entity note for PostGIS

Use `@Column({ type: 'geometry', spatialFeatureType: 'Geometry', srid: 4326 })` with TypeORM PostGIS support. Enable `"typeorm-extension"` or raw SQL fallback for complex spatial queries.

#### REST Endpoints

| Method | Path | Guard | Description |
|---|---|---|---|
| `GET` | `/gis/layers` | JWT | List layers visible to user (tenant-scoped + ABAC) |
| `POST` | `/gis/layers` | JWT + `gis.layer.create` | Create layer |
| `GET` | `/gis/layers/:id` | JWT | Get layer metadata |
| `PATCH` | `/gis/layers/:id` | JWT + owner/admin | Update layer style or name |
| `DELETE` | `/gis/layers/:id` | JWT + owner/admin | Archive layer |
| `GET` | `/gis/layers/:id/features` | JWT | GeoJSON FeatureCollection |
| `POST` | `/gis/layers/:id/features` | JWT + `gis.feature.create` | Create feature (GeoJSON geometry + properties) |
| `PATCH` | `/gis/layers/:id/features/:fid` | JWT + owner | Update feature |
| `DELETE` | `/gis/layers/:id/features/:fid` | JWT + owner | Soft-delete feature |
| `GET` | `/gis/incidents/:incidentId/features` | JWT | All features across layers for incident |
| `GET` | `/gis/features/nearby` | JWT | `?lat=&lng=&radius=` — ST_DWithin query |

#### `gis.service.ts` — PostGIS query examples

```typescript
// Read: return GeoJSON FeatureCollection
async getLayerFeatures(layerId: string): Promise<GeoJsonFeatureCollection> {
  const rows = await this.dataSource.query(`
    SELECT
      id,
      ST_AsGeoJSON(geometry)::jsonb AS geometry,
      properties,
      label,
      linked_incident_id,
      linked_task_id
    FROM gis.features
    WHERE layer_id = $1 AND deleted_at IS NULL
  `, [layerId]);

  return {
    type: 'FeatureCollection',
    features: rows.map(r => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: { ...r.properties, label: r.label },
    })),
  };
}

// Write: accept GeoJSON geometry
async createFeature(layerId: string, dto: CreateFeatureDto) {
  return this.dataSource.query(`
    INSERT INTO gis.features (layer_id, tenant_id, geometry, properties, label, created_by)
    VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4, $5, $6)
    RETURNING id
  `, [layerId, dto.tenantId, JSON.stringify(dto.geometry), dto.properties, dto.label, dto.createdBy]);
}
```

---

### Step 7 — Backend: Document Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/document/`

**New files:**

```
backend/src/modules/document/
├── document.module.ts
├── entities/
│   ├── document.entity.ts
│   ├── document-version.entity.ts
│   └── document-approval.entity.ts
├── controllers/
│   └── documents.controller.ts
├── services/
│   ├── document.service.ts
│   └── pdf-render.service.ts
└── templates/
    ├── initial-report.hbs
    ├── evacuation-order.hbs
    └── post-incident-report.hbs
```

#### Document lifecycle state machine

```
DRAFT → REVIEW → APPROVED → PUBLISHED
          ↓                    ↓
       REJECTED             ARCHIVED
                            REVOKED (tombstone)
```

- `DRAFT → REVIEW`: triggered by `POST /documents/:id/submit-review`
- `REVIEW → APPROVED`: requires all approval records to be `APPROVED`
- `APPROVED → PUBLISHED`: triggered by `POST /documents/:id/publish`
- Any state → `REVOKED`: writes a tombstone `DocumentVersion` with `kind='REVOCATION'`

#### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/documents` | Create from template (body: templateCode + templateVars) |
| `GET` | `/documents` | List documents (tenant-scoped, filterable by state, incidentId) |
| `GET` | `/documents/:id` | Get document with current version |
| `GET` | `/documents/:id/versions` | List all versions |
| `GET` | `/documents/:id/versions/:vid/url` | Presigned MinIO URL for PDF download |
| `POST` | `/documents/:id/submit-review` | Transitions DRAFT → REVIEW |
| `POST` | `/documents/:id/approve` | Add approval (body: comment) |
| `POST` | `/documents/:id/reject` | Reject current review cycle |
| `POST` | `/documents/:id/publish` | APPROVED → PUBLISHED (all approvals must be done) |
| `POST` | `/documents/:id/revoke` | Write tombstone, transition to REVOKED |

#### PDF rendering flow

```
POST /documents → document.service.create()
  → emit 'document.render_requested' event (non-blocking)
    → DocumentRenderListener picks up
      → pdf-render.service.renderFromTemplate(templateCode, vars)
        → Handlebars.compile(templateSource)(vars)
        → pdflib renders HTML-to-PDF (via puppeteer-in-worker or pdflib direct)
        → MinIO upload → create DocumentVersion record
          → emit 'document.version_ready' event
            → frontend re-fetches document (via SSE notification)
```

---

### Step 8 — Backend: Analytics Module

**Status:** ✅ Completed

**Module path:** `backend/src/modules/analytics/`

**New files:**

```
backend/src/modules/analytics/
├── analytics.module.ts
├── services/
│   ├── analytics.service.ts
│   └── analytics-etl.service.ts
├── listeners/
│   └── analytics.listener.ts
└── controllers/
    └── analytics.controller.ts
```

#### ETL Listener (`analytics.listener.ts`)

```typescript
@OnEvent('incident.closed', { async: true })
async onIncidentClosed(event: IncidentClosedEvent) {
  await this.etlService.materializeIncident(event.incidentId);
}

@OnEvent('task.status_changed', { async: true })
async onTaskStatusChanged(event: TaskStatusChangedEvent) {
  if (event.newStatus === 'done' || event.newStatus === 'cancelled') {
    await this.etlService.materializeTask(event.taskId);
  }
}
```

#### REST Endpoints

| Method | Path | Query Params | Description |
|---|---|---|---|
| `GET` | `/analytics/summary` | `from`, `to`, `tenantId` | KPI numbers (open incidents, overdue tasks, avg resolution time) |
| `GET` | `/analytics/incident-volume` | `from`, `to`, `groupBy=day\|week\|month` | Time-series incident counts |
| `GET` | `/analytics/task-throughput` | `from`, `to`, `incidentId?` | Tasks by status over time |
| `GET` | `/analytics/sla-compliance` | `from`, `to` | SLA breach rate |
| `GET` | `/analytics/by-category` | `from`, `to` | Incident counts by category |
| `GET` | `/analytics/export` | `format=csv`, `type=incidents\|tasks` | Download CSV |

---

## 4. Phase 2 — Frontend: Missing UI Surfaces

### Step 9 — Chat UI

**Status:** ✅ Completed

**Implemented notes:** Added `/chat`, shared chat API loader with mock fallback, Socket.IO client helper, Zustand chat store, message/channel/composer UI, file-upload proxy, incident `chat` tab, and sidebar navigation. Verified with `npm run lint` and `npm run build` in `frontend/`. Live socket delivery and real file upload still require a running backend with valid auth token and storage/AV dependencies.

**New files:**

```
frontend/
├── components/chat/
│   ├── channel-list.tsx
│   ├── chat-workspace-shell.tsx
│   ├── message-list.tsx
│   ├── message-bubble.tsx
│   ├── message-composer.tsx
│   ├── typing-indicator.tsx
│   └── incident-room-panel.tsx
├── lib/
│   ├── api/chat-workspace.ts
│   └── chat-socket.ts
├── stores/
│   └── chat-store.ts
├── app/(app)/
│   └── chat/
│       ├── actions.ts
│       └── page.tsx
└── app/api/files/upload/
    └── route.ts
```

#### `lib/chat-socket.ts`

```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getChatSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(`${process.env.NEXT_PUBLIC_API_URL}/chat`, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  return socket;
}

export function disconnectChatSocket() {
  socket?.disconnect();
  socket = null;
}
```

#### `stores/chat-store.ts` (Zustand)

```typescript
interface ChatState {
  channels: Record<string, Channel>;
  messages: Record<string, Message[]>;       // keyed by channelId
  unreadCounts: Record<string, number>;
  typingUsers: Record<string, string[]>;     // channelId → userId[]
  activeChannelId: string | null;

  // Actions
  setChannels(channels: Channel[]): void;
  appendMessage(channelId: string, msg: Message): void;
  setTyping(channelId: string, userId: string, isTyping: boolean): void;
  markRead(channelId: string): void;
}
```

#### `components/chat/message-list.tsx`

- Virtualized scroll using `@tanstack/react-virtual` (not `react-window` — already in stack)
- Auto-scroll to bottom on new message, unless user has scrolled up (detect scroll position)
- Group messages by sender within 2 minutes (no repeated avatar)
- Show date separator between messages on different days

#### `components/chat/message-composer.tsx`

- `<textarea>` with auto-resize (Shift+Enter = newline, Enter = send)
- File attach button → opens file picker → calls `POST /files/upload` → attaches `fileId` to message
- Emoji picker (lightweight: `emoji-mart` or simple hardcoded common set)
- Typing indicator: debounce `socket.emit('typing_start')` on keystroke, `typing_stop` on blur/submit

#### `components/chat/incident-room-panel.tsx`

- Embeds inside incident detail page as a third tab (`chat`)
- Auto-joins the `INCIDENT_ROOM` channel for this incident
- Shows participant list on the right (from incident participants, not channel members)
- Compact mode (no sidebar, full width message thread)

#### Integration into incident page

In `frontend/app/(app)/incidents/[id]/page.tsx`:
```tsx
// Add 'chat' tab
<TabsTrigger value="chat">
  Chat
  {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
</TabsTrigger>
<TabsContent value="chat">
  <IncidentRoomPanel incidentId={incident.id} />
</TabsContent>
```

---

### Step 10 — GIS / Map Workspace

**Status:** ✅ Completed

**Implemented notes:** Added a real `/map` workspace with SSR-safe MapLibre loading, GIS API workspace loader with mock fallback, layer visibility and opacity controls, feature popup, local draw layer, incident geofence summary, and incident-scoped SSE refresh for `gis.feature.*` events. The incident SSE transport now includes GIS events for the selected incident. Verified with `npm run lint` and `npm run build` in `frontend/`, plus `npm run build` and `npm test -- --runInBand` in `backend/`. Real GIS rendering still needs smoke-test against live PostGIS data and authenticated backend.

**New files:**

```
frontend/
├── components/gis/
│   ├── map-canvas.tsx           ← MapLibre GL wrapper (SSR-safe)
│   ├── layer-panel.tsx          ← toggle layers, opacity
│   ├── feature-popup.tsx        ← click on feature details
│   ├── draw-toolbar.tsx         ← draw polygon/point/line
│   ├── incident-geofence.tsx    ← polygon overlay per incident
│   └── map-workspace-shell.tsx
├── lib/api/
│   └── gis-workspace.ts
├── app/api/gis/workspace/
│   └── route.ts
└── app/(app)/map/
    └── page.tsx
```

#### `components/gis/map-canvas.tsx`

```tsx
'use client';
// IMPORTANT: MapLibre requires browser — always dynamic import
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useRef, useEffect } from 'react';

export function MapCanvas({ layers, features, onFeatureClick }) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mapRef.current = new maplibregl.Map({
      container: containerRef.current!,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [74.5698, 42.8746],  // Bishkek default
      zoom: 7,
    });

    return () => mapRef.current?.remove();
  }, []);

  // Update source data without re-mounting the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('features') as maplibregl.GeoJSONSource;
    if (source) source.setData({ type: 'FeatureCollection', features });
  }, [features]);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

**Page-level wrapper** (`app/(app)/map/page.tsx`):
```tsx
// dynamic() import for SSR safety
const MapCanvas = dynamic(
  () => import('@/components/gis/map-canvas').then(m => m.MapCanvas),
  { ssr: false, loading: () => <MapSkeleton /> }
);
```

#### Layer types to display

| Layer | Source | Update frequency |
|---|---|---|
| Base tiles | OpenStreetMap raster or PMTiles vector | Static |
| Incident geofences | `GET /gis/incidents/:id/features` | SSE `gis.feature.*` |
| Resource markers | `GET /gis/layers?kind=RESOURCE` | SSE `gis.feature.*` |
| Evacuation routes | `GET /gis/layers?kind=ROUTE` | On demand |
| Draw layer | Local state (user draws) | Local only |

#### Real-time map updates

```typescript
// In map-canvas.tsx, alongside EventSource
const es = new EventSource(`/api/incidents/${incidentId}/stream`);
es.addEventListener('gis.feature.updated', (e) => {
  const data = JSON.parse(e.data);
  const source = mapRef.current?.getSource('features') as maplibregl.GeoJSONSource;
  // Update or insert feature in the existing FeatureCollection
  source?.setData(patchFeature(currentFeatures, data.payload));
});
```

---

### Step 11 — Document Workspace UI

**Status:** ✅ Completed

**Implemented notes:** Added `/documents` register, `/documents/:id` detail page, document API loader with mock fallback, create-from-template form, document cards/list, PDF viewer via presigned URL proxy, approval chain panel with submit/approve/reject/publish actions, status badges, and sidebar navigation. Verified with `npm run lint` and `npm run build` in `frontend/`. Real PDF preview and mutations still need smoke-test against a live backend with valid auth and MinIO documents storage.

**New files:**

```
frontend/
├── components/document/
│   ├── document-list.tsx
│   ├── document-card.tsx
│   ├── document-viewer.tsx        ← PDF embed with MinIO presigned URL
│   ├── document-create-form.tsx   ← template picker + field inputs
│   ├── document-approval-panel.tsx ← approval chain status + sign button
│   └── document-status-badge.tsx
├── lib/api/
│   └── document-workspace.ts
├── app/api/documents/[id]/url/
│   └── route.ts
└── app/(app)/documents/
    ├── actions.ts
    ├── page.tsx
    └── [id]/
        └── page.tsx
```

#### `document-viewer.tsx`

```tsx
export function DocumentViewer({ documentId }: { documentId: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/url`)
      .then(r => r.json())
      .then(({ url }) => setPdfUrl(url));
  }, [documentId]);

  if (!pdfUrl) return <Skeleton className="w-full h-[800px]" />;

  return (
    <iframe
      src={pdfUrl}
      className="w-full h-[800px] border rounded-lg"
      title="Document viewer"
    />
  );
}
```

#### `document-approval-panel.tsx`

- Show each required approver: name + role + status badge (PENDING/APPROVED/REJECTED)
- If current user is a required approver and status is PENDING: show "Approve" / "Reject" buttons
- On approve: call `POST /documents/:id/approve` → optimistic update
- Show progress bar: `N / M approvals complete`

---

### Step 12 — Analytics Dashboard UI

**New files:**

```
frontend/
├── components/analytics/
│   ├── kpi-strip.tsx
│   ├── incident-volume-chart.tsx
│   ├── task-throughput-chart.tsx
│   ├── sla-compliance-gauge.tsx
│   ├── category-breakdown.tsx
│   └── date-range-picker.tsx
└── app/(app)/analytics/
    └── page.tsx                    ← scaffolded, needs chart composition
```

#### `app/(app)/analytics/page.tsx`

```tsx
// Server component: read date range from searchParams
export default async function AnalyticsPage({ searchParams }) {
  const from = searchParams.from ?? subDays(new Date(), 30).toISOString();
  const to   = searchParams.to   ?? new Date().toISOString();

  const [summary, volume, throughput, sla, categories] = await Promise.all([
    fetchAnalyticsSummary({ from, to }),
    fetchIncidentVolume({ from, to, groupBy: 'day' }),
    fetchTaskThroughput({ from, to }),
    fetchSlaCompliance({ from, to }),
    fetchCategoryBreakdown({ from, to }),
  ]);

  return (
    <div className="space-y-6 p-6">
      <DateRangePicker from={from} to={to} />
      <KpiStrip data={summary} />
      <div className="grid grid-cols-2 gap-6">
        <IncidentVolumeChart data={volume} />
        <TaskThroughputChart data={throughput} />
        <SlaComplianceGauge data={sla} />
        <CategoryBreakdown data={categories} />
      </div>
    </div>
  );
}
```

#### Chart components (Recharts)

- `IncidentVolumeChart` — `<AreaChart>` with gradient fill; responsive container
- `TaskThroughputChart` — `<BarChart>` stacked by status color
- `SlaComplianceGauge` — `<RadialBarChart>` showing % tasks completed within SLA
- `CategoryBreakdown` — `<PieChart>` with legend; click to filter
- All: `<ResponsiveContainer width="100%" height={300}>` wrapper

---

### Step 13 — Audit Trail UI

**New files:**

```
frontend/
├── components/audit/
│   ├── audit-log-table.tsx
│   ├── audit-event-detail.tsx     ← before/after JSON diff
│   └── audit-filters.tsx
└── app/(app)/audit/
    └── page.tsx
```

#### `audit-event-detail.tsx`

```tsx
// Simple before/after diff viewer using color-coded JSON
export function AuditEventDetail({ event }: { event: AuditEvent }) {
  return (
    <div className="grid grid-cols-2 gap-4 font-mono text-sm">
      <div className="bg-red-50 p-3 rounded">
        <p className="text-xs text-red-600 mb-2 font-sans">Before</p>
        <pre>{JSON.stringify(event.before, null, 2)}</pre>
      </div>
      <div className="bg-green-50 p-3 rounded">
        <p className="text-xs text-green-600 mb-2 font-sans">After</p>
        <pre>{JSON.stringify(event.after, null, 2)}</pre>
      </div>
    </div>
  );
}
```

**Table columns:** Timestamp | Actor | Event Type | Target | IP Address | Actions (view detail)

**Infinite scroll:** Use Intersection Observer to load next cursor page when the last row is visible.

---

### Step 14 — Incident Page: Timeline & Sitrep

**Status:** ◐ Partial

**Enhance:** `frontend/components/incident/incident-activity-feed.tsx`

**New files:**

```
frontend/components/incident/
├── incident-timeline.tsx          ← vertical timeline component
├── sitrep-form.tsx                ← submit situation report
└── sitrep-card.tsx                ← display one sitrep
```

#### `incident-timeline.tsx`

```tsx
const ENTRY_ICONS: Record<string, LucideIcon> = {
  status_change:       Flag,
  severity_change:     AlertTriangle,
  commander_assigned:  Star,
  participant_joined:  UserPlus,
  participant_left:    UserMinus,
  sitrep_submitted:    ClipboardList,
};

export function IncidentTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative border-l border-border ml-4">
      {entries.map(entry => {
        const Icon = ENTRY_ICONS[entry.kind] ?? Activity;
        return (
          <li key={entry.id} className="mb-6 ml-6">
            <span className="absolute -left-3 flex items-center justify-center
                             w-6 h-6 bg-background rounded-full ring-2 ring-border">
              <Icon className="w-3 h-3 text-muted-foreground" />
            </span>
            <p className="text-sm text-foreground">{describeTimelineEntry(entry)}</p>
            <time className="text-xs text-muted-foreground">
              {formatRelative(entry.createdAt, new Date())}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
```

#### `sitrep-form.tsx`

- Description textarea (required)
- Location input: manual lat/lng or "Use current location" button (`navigator.geolocation`)
- File attach: calls `POST /files/upload`, shows thumbnail preview before submit
- Severity selector: 1-5 radio buttons with color coding
- On submit: calls `POST /incidents/:id/sitreps` server action → optimistic insert into timeline

---

### Step 15 — Admin Panel

**New files:**

```
frontend/app/(app)/admin/
├── layout.tsx                    ← check platform_admin or tenant_admin role
├── page.tsx                      ← redirect to /admin/users
├── users/
│   └── page.tsx
├── roles/
│   └── page.tsx
└── tenants/
    └── page.tsx                  ← platform_admin only
```

```
frontend/components/admin/
├── user-table.tsx
├── user-form.tsx                 ← create/edit modal
├── role-permission-matrix.tsx    ← checkbox grid: roles × permissions
└── tenant-card.tsx
```

#### `user-table.tsx`

Columns: Full Name | Email | Role | Clearance | Status | Last Login | Actions

Actions: Edit (opens UserForm modal) | Disable | Reset Password (sends email)

#### `role-permission-matrix.tsx`

```tsx
// Rows = roles, Columns = permissions grouped by domain
// Each cell = checkbox; saving calls PATCH /iam/roles/:id/permissions
export function RolePermissionMatrix({ roles, permissions }) {
  const grouped = groupBy(permissions, p => p.code.split('.')[0]);

  return (
    <table>
      <thead>
        <tr>
          <th>Role</th>
          {Object.entries(grouped).map(([domain, perms]) => (
            <th key={domain} colSpan={perms.length}>{domain}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {roles.map(role => (
          <tr key={role.id}>
            <td>{role.name}</td>
            {permissions.map(perm => (
              <td key={perm.id}>
                <Checkbox
                  checked={role.permissions.includes(perm.id)}
                  onCheckedChange={(v) => handleToggle(role.id, perm.id, v)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## 5. Phase 3 — Advanced Features

### Step 16 — WebRTC Call System

**New backend files:**

```
backend/src/modules/call/
├── call.module.ts
├── entities/
│   ├── call-session.entity.ts
│   └── call-participant.entity.ts
├── gateways/
│   └── call.gateway.ts             ← signaling via Socket.IO
├── services/
│   ├── call-session.service.ts
│   └── mediasoup.service.ts
└── dto/
    ├── start-call.dto.ts
    └── join-call.dto.ts
```

#### mediasoup architecture

```
main.ts (startup):
  → spawn one mediasoup.Worker per CPU core (os.cpus().length)
  → each Worker manages Routers for active calls

Call flow:
  1. Client calls POST /calls/start (creates CallSession in DB)
  2. Client connects to socket, emits 'call.join' with callId
  3. CallGateway creates Router on a Worker (round-robin)
  4. Client emits 'transport.create' (direction: send | receive)
  5. Gateway creates WebRtcTransport, returns params to client
  6. Client calls transport.connect() with DTLS params
  7. Client emits 'producer.create' (kind: audio | video)
  8. Gateway creates Producer, broadcasts 'producer.new' to room
  9. Other clients emit 'consumer.create' for each producer
  10. Gateway creates Consumer, returns consumer params to client
```

#### `call.gateway.ts` events

```typescript
@SubscribeMessage('call.join')
async handleJoin(client: Socket, { callId }) { ... }

@SubscribeMessage('transport.create')
async handleTransportCreate(client: Socket, { callId, direction }) { ... }

@SubscribeMessage('transport.connect')
async handleTransportConnect(client: Socket, { transportId, dtlsParameters }) { ... }

@SubscribeMessage('producer.create')
async handleProducerCreate(client: Socket, { transportId, kind, rtpParameters }) { ... }

@SubscribeMessage('consumer.create')
async handleConsumerCreate(client: Socket, { producerId, rtpCapabilities }) { ... }
```

**New frontend files:**

```
frontend/
├── components/call/
│   ├── call-overlay.tsx            ← floating PiP-style call widget
│   ├── participant-tile.tsx         ← video/audio tile per participant
│   ├── call-controls.tsx           ← mute, camera, screen share, end call
│   └── call-invite-button.tsx      ← inline in chat channel header
└── lib/
    └── webrtc.ts                   ← mediasoup-client wrapper
```

---

### Step 17 — Mobile PWA

**New files:**

```
frontend/
├── app/
│   ├── manifest.json
│   └── (mobile)/
│       ├── layout.tsx              ← mobile-optimized layout
│       ├── incidents/
│       │   └── [id]/
│       │       └── page.tsx        ← simplified field view
│       └── sitrep/
│           └── new/
│               └── page.tsx        ← camera-first sitrep form
└── public/
    ├── sw.js                       ← Service Worker
    └── icons/                      ← PWA icon set (72, 96, 128, 144, 152, 192, 384, 512px)
```

#### `app/manifest.json`

```json
{
  "name": "CoESCD — Дежурный",
  "short_name": "CoESCD",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

#### `public/sw.js` (Service Worker strategy)

```javascript
const STATIC_CACHE = 'coescd-static-v1';
const API_CACHE    = 'coescd-api-v1';

// Cache-first for static assets (_next/static/*)
// Network-first for API calls (/api/*)
// Offline fallback for navigation routes
```

#### Responsive breakpoints

All existing components must work at these widths:
- `375px` — iPhone SE (field responder minimum)
- `768px` — tablet (shift supervisor portable display)
- `1280px+` — desktop workstation (default)

Audit each component in Phase 2 for mobile breakpoints. Add `md:` / `sm:` Tailwind variants where missing.

---

### Step 18 — Inter-Agency Liaison

**Backend additions:**

New table: `iam.tenant_invitations`
```sql
CREATE TABLE iam.tenant_invitations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  email           citext NOT NULL,
  role_code       text NOT NULL DEFAULT 'agency_liaison',
  incident_scope  uuid[],                -- limit to specific incident IDs
  token           text UNIQUE NOT NULL,   -- signed JWT, short TTL
  invited_by      uuid NOT NULL REFERENCES iam.users(id),
  accepted_at     timestamptz,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

New endpoint: `POST /tenants/:id/invite`
- Generates signed invitation JWT (24h TTL)
- Sends invitation email with link to `/accept-invite?token=...`
- On acceptance: creates user account with `agency_liaison` role scoped to `incident_scope`

**Frontend additions:**
- `app/(app)/incidents/[id]/page.tsx` — add "Invite Liaison" button (incident_commander+ only)
- `app/accept-invite/page.tsx` — public page to accept invitation

---

## 6. Phase 4 — Infrastructure & Production Hardening

### Step 19 — Dockerfiles

#### `backend/Dockerfile`

```dockerfile
# ---- build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
USER nestjs

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/main.js"]
```

#### `frontend/Dockerfile`

```dockerfile
# ---- deps stage ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

Enable standalone output in `frontend/next.config.js`:
```javascript
module.exports = { output: 'standalone' };
```

---

### Step 20 — Nginx Reverse Proxy

**New file:** `infra/docker/nginx/nginx.conf`

```nginx
events { worker_processes auto; }

http {
  # Rate limiting zones
  limit_req_zone $binary_remote_addr zone=api:10m rate=60r/s;
  limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
  limit_req_zone $binary_remote_addr zone=upload:10m rate=10r/m;

  upstream backend  { server backend:3001; }
  upstream frontend { server frontend:3000; }

  server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
  }

  server {
    listen 443 ssl http2;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # API proxy
    location /api/ {
      limit_req zone=api burst=100 nodelay;
      proxy_pass http://backend/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 300s;
    }

    # SSE endpoints — disable buffering
    location ~* /api/.*/stream {
      proxy_pass http://backend;
      proxy_set_header Connection '';
      proxy_http_version 1.1;
      proxy_buffering off;
      proxy_cache off;
      add_header X-Accel-Buffering no;
      proxy_read_timeout 3600s;  # Hold SSE connections open up to 1h
    }

    # WebSocket (Socket.IO)
    location /socket.io/ {
      proxy_pass http://backend;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 3600s;
    }

    # Auth endpoints — strict rate limit
    location /api/auth/ {
      limit_req zone=auth burst=5 nodelay;
      proxy_pass http://backend/auth/;
    }

    # File upload endpoints
    location /api/files/upload {
      limit_req zone=upload burst=10;
      client_max_body_size 510m;  # 500 MB + headers
      proxy_pass http://backend/files/upload;
      proxy_request_buffering off;  # Stream upload directly, no temp file
    }

    # Frontend (everything else)
    location / {
      proxy_pass http://frontend;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
  }
}
```

---

### Step 21 — Production Docker Compose

**New file:** `infra/docker/docker-compose.prod.yml`

```yaml
# Extends docker-compose.yml with production overrides
# Usage: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

services:
  backend:
    build:
      context: ../../backend
      dockerfile: Dockerfile
      target: runner
    restart: always
    environment:
      NODE_ENV: production
    secrets:
      - jwt_private_key
      - db_password
    # No direct port exposure — traffic goes through nginx only
    expose: ["3001"]
    deploy:
      replicas: 2
      resources:
        limits: { cpus: '2', memory: '2G' }
        reservations: { cpus: '0.5', memory: '512M' }

  frontend:
    build:
      context: ../../frontend
      dockerfile: Dockerfile
      target: runner
    restart: always
    expose: ["3000"]
    deploy:
      replicas: 2

  nginx:
    image: nginx:1.27-alpine
    restart: always
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on: [frontend, backend]

  postgres:
    restart: always
    volumes:
      - pgdata:/var/lib/postgresql/data
    # No port exposure in prod
    expose: ["5432"]

  redis:
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    expose: ["6379"]

  nats:
    restart: always
    expose: ["4222"]

  minio:
    restart: always
    expose: ["9000"]

volumes:
  pgdata:
  miniodata:
  opensearchdata:
  natsdata:

secrets:
  jwt_private_key:
    file: ./secrets/jwt_private_key.pem
  db_password:
    file: ./secrets/db_password.txt
```

---

### Step 22 — Observability Stack

#### `infra/docker/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: backend
    static_configs:
      - targets: ['backend:3001']
    metrics_path: /metrics

  - job_name: postgres_exporter
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: redis_exporter
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: nats
    static_configs:
      - targets: ['nats:8222']
    metrics_path: /metrics
```

#### Add to `docker-compose.yml` under `--profile observability`

```yaml
postgres-exporter:
  image: prometheuscommunity/postgres-exporter:latest
  profiles: ["observability"]
  environment:
    DATA_SOURCE_NAME: "postgresql://${DB_USER}:${DB_PASSWORD}@pgbouncer:6432/coescd?sslmode=disable"

redis-exporter:
  image: oliver006/redis_exporter:latest
  profiles: ["observability"]
  environment:
    REDIS_ADDR: redis:6379

promtail:
  image: grafana/promtail:latest
  profiles: ["observability"]
  volumes:
    - ./promtail/promtail.yml:/etc/promtail/config.yml:ro
    - /var/lib/docker/containers:/var/lib/docker/containers:ro

loki:
  image: grafana/loki:latest
  profiles: ["observability"]
  ports: ["3100:3100"]
```

#### Grafana dashboards to provision

Create `infra/docker/grafana/dashboards/`:
1. `api-overview.json` — Request rate, error rate, p50/p95/p99 latency by endpoint
2. `incident-operations.json` — Open incidents over time, incidents by severity/category
3. `infrastructure.json` — DB connections, Redis hit/miss, NATS lag, CPU/Memory

---

### Step 23 — Security Hardening

#### `backend/src/main.ts` additions

```typescript
import helmet from 'helmet';
import * as compression from 'compression';

// CORS
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

// Helmet CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', '*.minio.internal'],
      connectSrc: ["'self'", 'wss:'],
    },
  },
}));

// Compression — already excludes text/event-stream (done in existing code)
app.use(compression({ filter: (req, res) =>
  res.getHeader('Content-Type') !== 'text/event-stream'
}));

// Global validation pipe
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,          // strip unknown properties
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

#### MFA (TOTP) — complete the implementation

**Backend additions in `backend/src/modules/iam/`:**

```
services/mfa.service.ts       ← TOTP generation + verification
controllers/mfa.controller.ts ← enroll, verify, disable MFA
```

```typescript
// mfa.service.ts
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

async enrollMfa(userId: string): Promise<{ secret: string; qrCodeUrl: string }> {
  const secret = speakeasy.generateSecret({
    name: `CoESCD:${user.email}`,
    issuer: 'CoESCD',
  });

  // Store secret in user.attributes.mfa_secret (encrypted at rest)
  await this.userRepo.update(userId, {
    attributes: { ...user.attributes, mfa_pending_secret: secret.base32 },
  });

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrCodeUrl };
}

async verifyAndEnable(userId: string, token: string): Promise<void> {
  const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
  const secret = user.attributes.mfa_pending_secret;

  const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
  if (!valid) throw new UnauthorizedException('Invalid MFA token');

  await this.userRepo.update(userId, {
    mfaEnabled: true,
    attributes: {
      ...user.attributes,
      mfa_secret: secret,
      mfa_pending_secret: undefined,
    },
  });

  this.eventEmitter.emit('iam.mfa.enrolled.v1', { userId, tenantId: user.tenantId });
}
```

MFA endpoints:
- `POST /iam/mfa/enroll` — returns QR code data URL
- `POST /iam/mfa/verify` — confirms enrollment
- `DELETE /iam/mfa` — disables MFA (requires current password)
- `POST /auth/mfa` — second-factor login step

#### Break-glass access

```typescript
// POST /iam/break-glass
// Requires: current user is platform_admin or shift_lead
// Grants: target user gets elevated role for 4 hours
// Audit: mandatory — writes two audit entries (before/after)

async activateBreakGlass(actorId: string, targetUserId: string, reason: string): Promise<void> {
  await this.auditService.record({
    actorId,
    eventType: 'iam.breakglass.activated.v1',
    targetType: 'user',
    targetId: targetUserId,
    after: { reason, expiresAt: addHours(new Date(), 4) },
  });

  // Grant elevated role with expires_at = now() + 4h
  await this.userRoleRepo.insert({
    userId: targetUserId,
    roleId: BREAK_GLASS_ROLE_ID,
    grantedBy: actorId,
    expiresAt: addHours(new Date(), 4),
    scope: { reason, breakGlass: true },
  });

  // Schedule revocation via NATS delayed message or cron
  this.natsClient.publish('iam.breakglass.schedule_revoke', {
    userId: targetUserId,
    revokeAt: addHours(new Date(), 4).toISOString(),
  });
}
```

---

## 7. Sprint Schedule

| Sprint | Duration | Backend | Frontend | Infra |
|---|---|---|---|---|
| **S1** | Week 1-2 | DB migrations (all schemas), File module | — | Add backend/frontend Dockerfiles |
| **S2** | Week 3-4 | Chat module (REST + WebSocket) | Chat UI + incident room panel | Redis Socket.IO adapter |
| **S3** | Week 5-6 | GIS module | Map workspace (MapLibre) | — |
| **S4** | Week 7-8 | Notification module, Audit module | Notification bell UI | — |
| **S5** | Week 9-10 | Analytics module + ETL | Analytics dashboard UI | Prometheus + Grafana dashboards |
| **S6** | Week 11-12 | Document module + PDF render | Document workspace UI | MinIO bucket policies |
| **S7** | Week 13-14 | Admin panel REST (users, roles) | Admin panel UI | — |
| **S8** | Week 15 | Security hardening (MFA, break-glass) | MFA enrollment UI | Nginx + docker-compose.prod.yml |
| **S9** | Week 16 | — | Incident timeline + sitrep UI | Observability stack (Jaeger, Loki) |
| **S10** | Week 17-18 | WebRTC (mediasoup signaling) | Call overlay UI | mediasoup ports in docker |
| **S11** | Week 19-20 | PWA push notification (FCM token) | Mobile layouts + Service Worker | — |
| **S12** | Week 21-22 | Load testing, performance tuning | Audit trail UI, inter-agency | Production readiness review |

---

## 8. Critical Technical Rules

These rules apply to every file in every sprint. Breaking them causes architectural debt that compounds.

### Database

1. **All UUIDs are UUIDv7** — use `DEFAULT uuidv7()` in SQL; in TypeORM use `@PrimaryGeneratedColumn('uuid')` but override default via migration. Time-ordered inserts are B-tree friendly.
2. **No cross-schema joins in TypeORM entities** — use projected read models (`@ViewEntity`) instead.
3. **Every table has `tenant_id`** — always filter by it first. Row-Level Security enforces this in production.
4. **PgBouncer transaction mode constraints** — never use `SET LOCAL`, `LISTEN/NOTIFY`, advisory locks that span requests, or prepared statements with `?` placeholders (TypeORM parameter syntax is safe, raw queries must use `$1` placeholders).
5. **Audit table is append-only** — `REVOKE UPDATE, DELETE ON audit.events FROM coescd_app`. This is not optional.
6. **Soft deletes on tasks; hard deletes after archive on incidents** — never skip the `WHERE deleted_at IS NULL` filter.

### Backend (NestJS)

7. **Every REST handler that writes emits a domain event** — emit via `EventEmitter2` after commit, before returning response. Pattern: `this.eventEmitter.emit('incident.status_changed', payload)`.
8. **Domain events are in-process first** — `RealtimeEventsService` and `AuditListener` receive them synchronously. NATS publish is the async durable copy.
9. **A REST handler never awaits a downstream side effect** — emit event, return response, let listeners run in `{ async: true }` handlers.
10. **All DTOs use `class-validator` with `@IsNotEmpty()`, `@IsUUID()`, etc.** — `ValidationPipe({ whitelist: true })` strips unlisted properties. Never trust raw request body.
11. **Classification guard on every entity read** — before returning any entity with `classification` field, verify `user.clearance >= entity.classification`. Throw `ForbiddenException` otherwise.
12. **File downloads are presigned URLs only** — never pipe MinIO bytes through the NestJS process. Call `MinioService.presignedGetUrl()` and redirect or return the URL.
13. **ClamAV scan before MinIO write** — never skip for any upload, regardless of content type. If ClamAV is down, return 503 (do not allow uploads to bypass scan).

### Frontend (Next.js)

14. **MapLibre always uses `dynamic(() => import(...), { ssr: false })`** — MapLibre crashes on SSR. Never import at module level.
15. **Socket.IO client is a singleton** — use the pattern in `lib/chat-socket.ts`. Never create a new `io()` instance in a component render cycle.
16. **SSE EventSource lifecycle** — open in `useEffect`, close in cleanup (`es.close()`). Re-open on `document.visibilitychange` if closed (tab was hidden). Pattern already established in `task-workspace-live-shell.tsx`.
17. **Server Actions for all mutations** — do not use client-side `fetch` for writes. Server Actions handle auth cookies server-side and call `revalidatePath()` after commit.
18. **No `localStorage` for auth tokens** — tokens live in HTTP-only cookies managed by the backend. The frontend never reads or stores JWTs.
19. **Zustand stores are for UI state only** — do not put server data into Zustand. Use TanStack Query for server state, or Server Components + props. Zustand owns: active tab, open modals, chat typing indicators, map view state.
20. **All chart components use `<ResponsiveContainer>`** — never hardcode pixel widths for Recharts.

### Infrastructure

21. **SSE routes bypass Nginx buffering** — `proxy_buffering off; proxy_cache off; add_header X-Accel-Buffering no` for any path matching `*/stream*`. Already in the nginx.conf template above.
22. **WebSocket upgrades are explicit** — `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"` on `/socket.io/` location.
23. **Secrets never in environment variables in production** — use Docker Secrets (`secrets:` in compose) or a vault. The `.env` file is for development only; it must be in `.gitignore`.
24. **Named volumes for all stateful services** — `pgdata`, `miniodata`, `natsdata`, `opensearchdata`. Never use bind mounts for database data in production.
25. **Health checks on every service** — backend `GET /health`, frontend `GET /api/health`, postgres `pg_isready`. `depends_on` conditions use `service_healthy` not just `service_started`.

### Cross-Cutting

26. **Bounded context isolation is enforced** — no `JOIN` across schema boundaries in TypeORM. Cross-context data is projected via events into local read model tables.
27. **Every write operation produces an audit trail** — either directly (via `AuditListener` catching domain events) or explicitly via `AuditService.record()` for security-sensitive ops (login, MFA, break-glass).
28. **Error responses follow RFC 7807** — `{ type, title, status, detail, instance }`. Use NestJS `HttpException` with a consistent factory function; never return raw `{ message: 'error' }`.
29. **Pagination is always cursor-based for large collections** — use `id > $cursor ORDER BY id LIMIT $limit`. Offset pagination degrades on large tables. Exception: small admin lists (<100 rows) may use offset.
30. **Tests are required for every service** — unit test services with mocked repos; integration test controllers with a real in-memory SQLite or test PostgreSQL database. No test, no merge.
