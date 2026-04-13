# Audit Module -- Tamper-Evident Append-Only Audit Trail

## 1. Purpose

The Audit module provides a tamper-evident, append-only audit trail for every significant action performed across the CoESCD disaster management platform.

### Ownership Boundaries

Audit **owns**:

- All audit event records (append-only, immutable)
- HMAC-SHA256 chain integrity for tamper detection
- Signed exports for compliance delivery
- Retention management across hot/warm/cold tiers
- Break-glass review tracking
- Audit export job lifecycle

Audit **does not own**:

- Domain-specific business logic (each module emits domain events; Audit consumes and persists them)
- Authentication or authorization evaluation (delegates to IAM; Audit records the outcomes)
- Real-time alerting beyond chain-break detection (delegates to Notification module for delivery)
- Long-term archival infrastructure provisioning (delegates to platform ops for S3-compatible storage)

Every domain module in the platform emits events that Audit consumes. Audit is a **universal consumer** -- it subscribes to all domain event subjects via wildcard subscriptions on NATS JetStream.

### Design Principles

- **No updates, no deletes -- EVER.** The application database role has only INSERT and SELECT privileges. UPDATE and DELETE are revoked at the PostgreSQL role level. Even database administrators operating through standard tooling cannot modify or remove audit rows without bypassing role-level security.
- **Separate physical schema.** The `audit` schema is isolated from all other module schemas. Cross-schema foreign keys are not used; referential integrity is maintained through domain event contracts.
- **HMAC chain integrity.** Each audit event's signature incorporates the previous event's signature, creating a tamper-evident chain. Any modification to a historical record breaks the chain and is detectable.
- **7-year retention.** All audit events are retained for a minimum of 7 years across tiered storage: hot (primary database, 0-90 days), warm (compressed read replicas, 90 days-2 years), cold (detached partitions in S3-compatible object storage, 2-7 years).
- **5 billion events per year target.** Approximately 160 events per second sustained, with burst capacity of 20,000 events per second. Achieved through monthly range partitioning, batch inserts, and COPY protocol for bulk ingestion.

### Consumers of Audit Data

- **External auditors**: compliance reviews, SOC 2 / ISO 27001 evidence
- **Internal compliance team**: periodic access reviews, policy violation detection
- **Incident investigators**: post-incident timeline reconstruction
- **Break-glass reviewers**: mandatory 24-hour review of emergency access escalations
- **Platform administrators**: system health monitoring, anomaly detection dashboards

---

## 2. Domain Model

### Aggregates

#### AuditEvent (Aggregate Root -- Append-Only)

| Column        | Type        | Notes                                                                 |
| ------------- | ----------- | --------------------------------------------------------------------- |
| id            | uuid (v7)   | PK (composite with ts for partitioning)                               |
| tenant_id     | uuid        | NOT NULL, tenant context for RLS                                      |
| ts            | timestamptz | NOT NULL, set by DB `now()` at INSERT time, partition key             |
| actor_id      | uuid        | Nullable -- null for system-initiated actions                         |
| actor_ip      | inet        | Nullable -- null for system actions and async background jobs         |
| actor_type    | text        | NOT NULL, CHECK (actor_type IN ('user','system','api_key','break_glass')) |
| action        | text        | NOT NULL, dot-separated domain.action format (e.g., 'incident.created') |
| resource_type | text        | NOT NULL, the type of resource affected (e.g., 'incident', 'user')   |
| resource_id   | uuid        | NOT NULL, the ID of the specific resource affected                    |
| before        | jsonb       | Nullable -- state before change, null for creates                     |
| after         | jsonb       | Nullable -- state after change, null for deletes                      |
| reason        | text        | Nullable -- required for break-glass, severity changes, role assignments |
| metadata      | jsonb       | NOT NULL DEFAULT '{}', additional context (see below)                 |
| signature     | text        | NOT NULL, HMAC-SHA256 chain signature                                 |

Primary key: `(id, ts)` -- composite key required for PostgreSQL range partitioning on `ts`.

The `metadata` JSONB column carries structured context:

```typescript
interface AuditMetadata {
  /** UUIDv7 correlation ID for distributed tracing */
  correlationId: string;
  /** ID of the command or event that caused this audit event */
  causationId: string;
  /** HTTP request ID from the API gateway */
  requestId?: string;
  /** Client user-agent string */
  userAgent?: string;
  /** Original domain event type (e.g., 'iam.user.created.v1') */
  sourceEventType: string;
  /** Original domain event ID */
  sourceEventId: string;
}
```

### Value Objects

- **AuditAction**: Dot-separated string in the format `domain.verb` or `domain.noun.verb`. Must match the pattern `^[a-z]+\.[a-z_.]+$`. Examples: `iam.user.created`, `incident.severity_changed`, `document.approved`, `audit.export.requested`. The action is derived from the domain event type by stripping the version suffix.
- **AuditSignature**: HMAC-SHA256 chain value. Each event's signature is computed as `HMAC-SHA256(key, canonical_payload + previous_signature)`. The canonical payload is a JSON string of `[id, tenant_id, ts, actor_id, action, resource_type, resource_id, SHA256(before), SHA256(after)]`. The first event in a chain segment uses a well-known genesis signature (`0000000000000000000000000000000000000000000000000000000000000000`). Chain breaks (due to detected tampering or key rotation) start a new segment with the genesis signature and the break is recorded as an audit event itself.
- **RetentionTier**: Enum of `hot | warm | cold` describing the storage tier. Hot = primary PostgreSQL (0-90 days), Warm = compressed read replica (90 days-2 years), Cold = detached partitions exported to S3-compatible object storage as Parquet files (2-7 years).

### Supporting Tables

#### AuditExport

| Column         | Type        | Notes                                                 |
| -------------- | ----------- | ----------------------------------------------------- |
| id             | uuid (v7)   | PK                                                    |
| tenant_id      | uuid        | Nullable -- null for platform-wide exports            |
| requested_by   | uuid        | NOT NULL, actor who requested the export              |
| filters        | jsonb       | NOT NULL, the filter criteria used                    |
| format         | text        | NOT NULL, CHECK (format IN ('csv', 'json'))           |
| status         | text        | NOT NULL DEFAULT 'processing', CHECK (status IN ('processing','ready','failed')) |
| events_count   | bigint      | Nullable, populated when export completes             |
| file_path      | text        | Nullable, MinIO object path when ready                |
| download_url   | text        | Nullable, pre-signed URL when ready                   |
| verification_hash | text     | Nullable, SHA-256 of the exported file                |
| chain_verified | boolean     | Nullable, whether HMAC chain was verified during export |
| error_message  | text        | Nullable, populated on failure                        |
| created_at     | timestamptz | NOT NULL DEFAULT now()                                |
| completed_at   | timestamptz | Nullable                                              |
| expires_at     | timestamptz | Nullable, when the download URL expires               |

#### BreakGlassReview

| Column       | Type        | Notes                                                    |
| ------------ | ----------- | -------------------------------------------------------- |
| id           | uuid (v7)   | PK                                                       |
| event_id     | uuid        | NOT NULL, references the break-glass audit event         |
| event_ts     | timestamptz | NOT NULL, ts of the referenced audit event (for partition routing) |
| tenant_id    | uuid        | NOT NULL                                                 |
| reviewed_by  | uuid        | NOT NULL, the reviewer's user ID                         |
| decision     | text        | NOT NULL, CHECK (decision IN ('acknowledged', 'escalated')) |
| comment      | text        | NOT NULL, reviewer's notes                               |
| reviewed_at  | timestamptz | NOT NULL DEFAULT now()                                   |

### Relationships

```
AuditEvent has no foreign keys -- referential integrity is maintained through domain event contracts.
AuditExport references AuditEvent implicitly through filter criteria.
BreakGlassReview references AuditEvent by (event_id, event_ts) but without a DB-level FK constraint
  (because audit.events is partitioned and FK to partitioned tables adds complexity).

tenant_id on all tables enables RLS filtering.
```

### No Lifecycle State Machine

AuditEvent has no state transitions. It is created once and never modified. AuditExport has a simple linear progression: `processing -> ready | failed`. There is no reverse transition.

---

## 3. Business Rules

### Invariants

1. **No updates allowed.** The application database role (`app_role`) has INSERT and SELECT only on `audit.events`. UPDATE and DELETE are explicitly revoked. A PostgreSQL event trigger logs any attempt to grant UPDATE or DELETE on the audit schema.
2. **No deletes allowed.** Not even soft deletes. There is no `deleted_at` column. Retention is managed exclusively through partition detachment -- the partition is detached from the table and exported to cold storage, but the data within it is never modified or destroyed before the 7-year retention period expires.
3. **Every audit event must have**: `tenant_id`, `actor_type`, `action`, `resource_type`, `resource_id`, `ts`, and `signature`. The `actor_id` is required unless `actor_type = 'system'`.
4. **HMAC chain integrity.** The `signature` field is computed as: `HMAC-SHA256(signing_key, canonical_payload + previous_event_signature)`. The canonical payload is deterministic JSON: `JSON.stringify([id, tenant_id, ts.toISOString(), actor_id, action, resource_type, resource_id, SHA256(JSON.stringify(before)), SHA256(JSON.stringify(after))])`. The signing key is stored in a secrets manager (AWS Secrets Manager or HashiCorp Vault), never in the database or application configuration files.
5. **Chain verification on read.** When audit events are queried for compliance export or chain verification, the HMAC chain is re-computed and validated. Any break in the chain is reported as a critical finding.
6. **Break-glass actions require a reason.** Any audit event with `actor_type = 'break_glass'` must have a non-null, non-empty `reason` field. The application layer enforces this before INSERT.
7. **Timestamp is server-authoritative.** The `ts` column is set by `now()` at INSERT time via a database DEFAULT. The application cannot override it. This prevents clock skew between application nodes from affecting audit ordering.
8. **Monthly range partitioning.** The `audit.events` table is partitioned by RANGE on `ts` with monthly boundaries. Partitions are pre-created 3 months in advance by pg_partman.
9. **Retention tiering.**
   - **Hot (0-90 days):** Primary PostgreSQL database. Full index coverage. Used for real-time queries.
   - **Warm (90 days-2 years):** Read replica with compressed tablespace. Indexes reduced to (tenant_id, ts) only.
   - **Cold (2-7 years):** Partitions detached from the live table, exported as Parquet to S3-compatible storage (MinIO). Queryable via re-attachment for investigations.
   - **Purge (>7 years):** Partitions are destroyed. A final SHA-256 manifest of the partition is retained permanently as proof of proper disposal.
10. **Audit of audit.** Reading audit events via the API creates an audit event with `action = 'audit.read'`. This prevents covert access to the audit log. Exception: `audit.read` events themselves are NOT recursively audited (see Edge Cases section).
11. **Export integrity.** Every export includes a SHA-256 hash of the exported file and a summary of HMAC chain verification results. The hash is stored in `audit.exports.verification_hash` and included in the export metadata.

### Constraints

| Constraint                     | Scope         | Implementation                                                  |
| ------------------------------ | ------------- | --------------------------------------------------------------- |
| action format                  | Per row       | CHECK (action ~ '^[a-z]+\.[a-z_.]+$')                          |
| resource_type known values     | Per row       | CHECK (resource_type IN ('user','tenant','role','policy','session','api_key','incident','task','document','message','file','layer','feature','export','breakglass_review')) |
| signature non-empty            | Per row       | CHECK (signature <> '' AND signature IS NOT NULL)               |
| actor_id required for non-system | Per row     | CHECK (actor_type = 'system' OR actor_id IS NOT NULL)           |
| break-glass requires reason    | Per row       | CHECK (actor_type <> 'break_glass' OR (reason IS NOT NULL AND length(reason) >= 10)) |
| ts immutable                   | Column        | DEFAULT now(), no application override (column not in INSERT column list for app) |
| actor_type valid               | Per row       | CHECK (actor_type IN ('user','system','api_key','break_glass')) |
| export format valid            | Per row       | CHECK (format IN ('csv','json'))                                |
| export status valid            | Per row       | CHECK (status IN ('processing','ready','failed'))               |
| review decision valid          | Per row       | CHECK (decision IN ('acknowledged','escalated'))                |

### Validation Rules

| Field         | Rule                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| action        | Must match `^[a-z]+\.[a-z_.]+$`, max 200 chars                                   |
| resource_type | Must be in the known types enum, max 50 chars                                     |
| reason        | Min 10 chars when required (break-glass, severity changes), max 2000 chars        |
| before/after  | Valid JSON objects, max 1 MB each (enforced at application layer)                 |
| metadata      | Valid JSON object, must contain `correlationId` and `sourceEventType` at minimum  |
| signature     | 64-character hex string (SHA-256 output)                                          |
| actor_ip      | Valid IPv4 or IPv6 address                                                        |

---

## 4. Use Cases (Application Layer)

### Commands

#### WriteAuditEvent

- **Input**: Domain event from NATS JetStream (any `*.*.v1` subject)
- **Flow**: NATS consumer receives domain event -> extract audit-relevant fields using event-type-specific mapper -> validate all required fields present -> fetch previous event's signature from Redis cache (`audit:last_signature:{tenant_id}`) -> compute HMAC-SHA256 signature (chained with previous) -> INSERT into `audit.events` -> update Redis cache with new signature -> ACK the NATS message.
- **Batch mode**: Under high load (>1000 messages buffered), the consumer switches to batch mode: accumulate up to 1000 events, compute chain signatures sequentially within the batch, INSERT using multi-row VALUES or COPY protocol, then ACK all messages.
- **Failure handling**: If INSERT fails, the event is NACKed with a delay and retried up to 3 times. After 3 failures, the event is published to a dead-letter queue (`audit.dlq`) and an alert is emitted to the Notification module. The NATS message is ACKed to prevent blocking the consumer, but an `audit.write.failed.v1` event is emitted for monitoring.
- **Idempotency**: The `id` field (UUIDv7 from the source event) combined with `ts` forms the primary key. Duplicate INSERTs are caught by the PK constraint and silently ignored (ON CONFLICT DO NOTHING).
- **Authorization**: None -- this is an internal NATS consumer, not an API endpoint. All domain events are trusted after NATS authentication.

#### ExportAuditLog

- **Input**: `{ tenantId?, actorId?, action?, resourceType?, resourceId?, from: string, to: string, format: 'csv' | 'json' }`
- **Flow**: Validate actor has `audit.export` permission -> create `audit.exports` row with status `processing` -> return `{ exportId, status: 'processing' }` immediately (HTTP 202) -> enqueue export job to NATS (`audit.export.execute`) -> worker picks up job -> execute paginated query with cursor (1000 rows per page) -> verify HMAC chain as rows are streamed -> write rows to temp file -> upload to MinIO -> compute SHA-256 of file -> generate pre-signed download URL (24h TTL) -> update `audit.exports` row with `status = 'ready'`, `download_url`, `verification_hash`, `events_count`, `chain_verified` -> emit `audit.export.ready.v1`.
- **Large dataset handling**: For exports exceeding 10 million rows, the export is split into multiple files (max 5 million rows each), bundled into a ZIP archive, and uploaded as a single object.
- **Progress tracking**: The export worker updates a Redis key (`audit:export:{exportId}:progress`) with the current row count every 10,000 rows. Clients can poll or subscribe via WebSocket for progress updates.
- **Error codes**: `IAM_PERMISSION_DENIED`, `AUDIT_QUERY_TIMEOUT`, `AUDIT_EXPORT_FAILED`

#### VerifyChain

- **Input**: `{ from: string, to: string, tenantId?: string }`
- **Flow**: Validate actor has `audit.verify` permission -> query events ordered by `(ts, id)` for the specified range -> for each event, recompute HMAC signature using the stored previous signature -> compare with stored signature -> if mismatch found, record the break point -> return verification report.
- **Output**: `{ verified: boolean, eventsChecked: number, chainSegments: number, firstBrokenLink?: { eventId, ts, expectedSignature, actualSignature } }`
- **Performance**: Verification processes events in streaming fashion (cursor-based, 10,000 rows per fetch) to avoid loading the entire range into memory. For ranges exceeding 100 million events, the verification is executed as a background job with progress tracking.
- **Error codes**: `IAM_PERMISSION_DENIED`, `AUDIT_QUERY_TIMEOUT`, `AUDIT_PARTITION_NOT_AVAILABLE`

#### DetachPartition

- **Input**: Scheduled job (runs daily at 02:00 UTC) or manual trigger by platform_admin
- **Flow**: Identify partitions where all rows have `ts` older than the retention threshold for the current tier -> for hot-to-warm (>90 days): detach partition from primary, export as compressed Parquet, attach to warm read replica -> for warm-to-cold (>2 years): detach from warm replica, upload Parquet to S3-compatible storage, record manifest in `audit.partition_manifests` -> for cold purge (>7 years): verify manifest, destroy S3 object, record destruction in permanent manifest log.
- **Safety**: Before detaching, verify that the partition has been successfully replicated to the next tier. The detach operation is wrapped in a transaction with a 30-minute lock timeout. If the lock cannot be acquired, the operation is retried the next day.

#### RestorePartition

- **Input**: `{ partitionName: string, reason: string }` (manual trigger by platform_admin)
- **Flow**: Validate actor has platform_admin role -> download Parquet from S3 -> create temporary table with matching schema -> load data via COPY -> attach as read-only partition -> set auto-detach timer (72 hours) -> emit audit event recording the restoration -> return success.
- **Auto-detach**: A scheduled job checks for temporarily restored partitions every hour and detaches any that have exceeded the 72-hour window.
- **Error codes**: `IAM_PERMISSION_DENIED`, `AUDIT_PARTITION_NOT_AVAILABLE`

#### ReviewBreakGlass

- **Input**: `{ eventId: string, decision: 'acknowledged' | 'escalated', comment: string }`
- **Flow**: Validate actor has `audit.breakglass.review` permission -> validate the referenced audit event exists and has `actor_type = 'break_glass'` -> validate the event has not already been reviewed -> INSERT into `audit.breakglass_reviews` -> if decision is `escalated`: emit notification to all platform_admins and the tenant's security officer -> emit audit event for the review itself.
- **24-hour requirement**: A scheduled job runs every hour and identifies break-glass events older than 24 hours that have no corresponding review. For each unreviewed event, an escalation notification is sent to all platform_admins and the shift_lead role.
- **Error codes**: `AUDIT_EVENT_NOT_FOUND`, `IAM_PERMISSION_DENIED`

### Queries

#### ListAuditEvents

- **Input**: `{ tenantId?, actorId?, action?, resourceType?, resourceId?, actorType?, from?, to?, cursor?, limit? }`
- **Flow**: Validate actor has `audit.read` permission -> if actor is `tenant_admin`, scope query to their tenant_id -> build query with filters -> execute with cursor-based pagination on `(ts DESC, id DESC)` -> emit `audit.read` audit event with query parameters in metadata -> return results.
- **Pagination**: Cursor encodes `(ts, id)` of the last row, base64url-encoded. Default limit is 25, maximum 100.
- **Performance**: All filter combinations are covered by composite indexes. Queries without a `ts` range are rejected (must specify `from` and `to` to prevent full-table scans). Maximum time range per query: 90 days for hot tier, 365 days for warm tier.

#### GetAuditEvent

- **Input**: `{ id: string }`
- **Flow**: Validate actor has `audit.read` permission -> query by `id` (requires scanning across partitions since `ts` is not provided; mitigated by UUIDv7 which encodes timestamp, allowing the query planner to prune partitions) -> emit `audit.read` event -> return result.
- **Error codes**: `AUDIT_EVENT_NOT_FOUND`

#### SearchAuditEvents

- **Input**: `{ q: string, tenantId?, from?, to? }`
- **Flow**: Validate actor has `audit.read` permission -> forward query to OpenSearch index (`coescd-audit-*`) -> OpenSearch returns matching event IDs -> fetch full events from PostgreSQL -> emit `audit.read` event -> return results.
- **OpenSearch integration**: Audit events are indexed to OpenSearch asynchronously via a dedicated NATS consumer. The index includes: `action`, `resource_type`, `reason`, `actor_type`, and `metadata.sourceEventType`. Full-text search is available on `reason` and `action`.
- **Index pattern**: Monthly indices matching `coescd-audit-YYYY-MM`, with ILM policy mirroring PostgreSQL retention tiers.

#### GetAuditStats

- **Input**: `{ tenantId?, from: string, to: string, groupBy: 'action' | 'actor' | 'resource_type' | 'day' }`
- **Flow**: Validate actor has `audit.read` permission -> execute aggregate query with GROUP BY on the requested dimension -> return counts and breakdowns.
- **Performance**: For frequently requested stats (last 24h, last 7d), results are cached in Redis with a 5-minute TTL. Cache key: `audit:stats:{tenantId}:{groupBy}:{from}:{to}`.

#### GetBreakGlassAuditTrail

- **Input**: `{ from?, to?, reviewed?: boolean }`
- **Flow**: Validate actor has `audit.breakglass.review` permission -> query `audit.events` WHERE `actor_type = 'break_glass'` -> LEFT JOIN with `audit.breakglass_reviews` to include review status -> return results with review metadata.
- **Highlight**: Unreviewed events older than 24 hours are flagged with `overdue: true` in the response.

#### VerifyChainIntegrity

Same as the VerifyChain command but exposed as a read-only query endpoint for auditors who want to verify without modifying state. Returns the same verification report.

---

## 5. API Contracts

### Audit Event Endpoints (JWT Required)

#### GET /api/v1/audit/events

```
Query Parameters:
  cursor: string (opaque cursor for pagination, base64url-encoded)
  limit: number (1-100, default 25)
  filter[tenant_id]: uuid
  filter[actor_id]: uuid
  filter[action]: string (exact match or prefix with wildcard, e.g., 'iam.*')
  filter[resource_type]: string
  filter[resource_id]: uuid
  filter[actor_type]: "user" | "system" | "api_key" | "break_glass"
  filter[from]: string (ISO 8601 timestamp, REQUIRED)
  filter[to]: string (ISO 8601 timestamp, REQUIRED)

Response 200:
{
  "data": AuditEventDto[],
  "page": {
    "nextCursor": "string | null",
    "prevCursor": "string | null",
    "limit": 25,
    "hasMore": true
  }
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "filter[from] and filter[to] are required" }
  400: { code: "VALIDATION_ERROR", message: "Time range must not exceed 90 days" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.read permission" }
  504: { code: "AUDIT_QUERY_TIMEOUT", message: "Query exceeded 30-second timeout" }
```

#### GET /api/v1/audit/events/:id

```
Path Parameters:
  id: uuid (UUIDv7 of the audit event)

Response 200:
{
  "data": AuditEventDto
}

Error Responses:
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.read permission" }
  404: { code: "AUDIT_EVENT_NOT_FOUND", message: "Audit event not found" }
```

#### GET /api/v1/audit/events/search

```
Query Parameters:
  q: string (full-text search query, REQUIRED)
  filter[tenant_id]: uuid
  filter[from]: string (ISO 8601, REQUIRED)
  filter[to]: string (ISO 8601, REQUIRED)
  cursor: string
  limit: number (1-100, default 25)

Response 200:
{
  "data": AuditEventDto[],
  "page": {
    "nextCursor": "string | null",
    "prevCursor": "string | null",
    "limit": 25,
    "hasMore": true
  }
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "q parameter is required" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.read permission" }
  504: { code: "AUDIT_QUERY_TIMEOUT", message: "Search exceeded 30-second timeout" }
```

### Stats Endpoint

#### GET /api/v1/audit/stats

```
Query Parameters:
  tenant_id: uuid (optional, platform_admin can omit for cross-tenant)
  from: string (ISO 8601, REQUIRED)
  to: string (ISO 8601, REQUIRED)
  group_by: "action" | "actor" | "resource_type" | "day" (REQUIRED)

Response 200:
{
  "data": [
    {
      "key": "string (the group value, e.g., action name or date)",
      "count": 12345,
      "percentage": 15.2
    }
  ],
  "meta": {
    "totalEvents": 81234,
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-01-31T23:59:59Z",
    "groupBy": "action"
  }
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "from, to, and group_by are required" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.read permission" }
```

### Export Endpoints

#### POST /api/v1/audit/export

```
Request Body:
{
  "tenantId": "uuid (optional)",
  "actorId": "uuid (optional)",
  "action": "string (optional, exact or prefix match)",
  "resourceType": "string (optional)",
  "resourceId": "uuid (optional)",
  "from": "2026-01-01T00:00:00Z (REQUIRED)",
  "to": "2026-01-31T23:59:59Z (REQUIRED)",
  "format": "csv" | "json"
}

Response 202:
{
  "exportId": "uuid",
  "status": "processing"
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "from, to, and format are required" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.export permission" }
```

#### GET /api/v1/audit/export/:exportId

```
Path Parameters:
  exportId: uuid

Response 200 (processing):
{
  "exportId": "uuid",
  "status": "processing",
  "progress": {
    "eventsProcessed": 45000,
    "estimatedTotal": 120000
  }
}

Response 200 (ready):
{
  "exportId": "uuid",
  "status": "ready",
  "downloadUrl": "https://minio.internal/audit-exports/...",
  "verificationHash": "sha256:abc123...",
  "chainVerified": true,
  "eventsCount": 120000,
  "format": "csv",
  "expiresAt": "2026-04-13T12:00:00Z"
}

Response 200 (failed):
{
  "exportId": "uuid",
  "status": "failed",
  "errorMessage": "Query timeout after processing 5,000,000 rows"
}

Error Responses:
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.export permission" }
  404: { code: "AUDIT_EXPORT_NOT_FOUND", message: "Export job not found" }
```

### Chain Verification Endpoint

#### POST /api/v1/audit/verify

```
Request Body:
{
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-01-31T23:59:59Z",
  "tenantId": "uuid (optional)"
}

Response 200:
{
  "verified": true,
  "eventsChecked": 4500000,
  "chainSegments": 1,
  "durationMs": 45200,
  "firstBrokenLink": null
}

Response 200 (chain broken):
{
  "verified": false,
  "eventsChecked": 4500000,
  "chainSegments": 2,
  "durationMs": 45200,
  "firstBrokenLink": {
    "eventId": "uuid",
    "ts": "2026-01-15T14:23:01.123Z",
    "expectedSignature": "abc123...",
    "actualSignature": "def456..."
  }
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "from and to are required" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.verify permission" }
  504: { code: "AUDIT_QUERY_TIMEOUT", message: "Verification exceeded timeout" }
  503: { code: "AUDIT_PARTITION_NOT_AVAILABLE", message: "Requested range includes cold partitions not currently attached" }
```

### Break-Glass Endpoints

#### GET /api/v1/audit/breakglass

```
Query Parameters:
  filter[from]: string (ISO 8601)
  filter[to]: string (ISO 8601)
  filter[reviewed]: boolean (true = reviewed only, false = unreviewed only, omit = all)
  filter[tenant_id]: uuid
  cursor: string
  limit: number (1-100, default 25)

Response 200:
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "ts": "2026-04-10T08:15:00Z",
      "actorId": "uuid",
      "actorIp": "192.168.1.100",
      "action": "iam.breakglass.activated",
      "resourceType": "incident",
      "resourceId": "uuid",
      "reason": "Emergency access required for critical infrastructure incident IC-2026-0412",
      "metadata": { ... },
      "review": {
        "reviewedBy": "uuid",
        "decision": "acknowledged",
        "comment": "Verified legitimate emergency access during Incident IC-2026-0412",
        "reviewedAt": "2026-04-10T14:30:00Z"
      } | null,
      "overdue": false
    }
  ],
  "page": { "nextCursor": "...", "prevCursor": "...", "limit": 25, "hasMore": false }
}

Error Responses:
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.breakglass.review permission" }
```

#### POST /api/v1/audit/breakglass/:eventId/review

```
Path Parameters:
  eventId: uuid

Request Body:
{
  "decision": "acknowledged" | "escalated",
  "comment": "string (min 10 chars, max 2000 chars)"
}

Response 200:
{
  "reviewId": "uuid",
  "eventId": "uuid",
  "decision": "acknowledged",
  "reviewedAt": "2026-04-10T14:30:00Z"
}

Error Responses:
  400: { code: "VALIDATION_ERROR", message: "comment must be at least 10 characters" }
  403: { code: "IAM_PERMISSION_DENIED", message: "Requires audit.breakglass.review permission" }
  404: { code: "AUDIT_EVENT_NOT_FOUND", message: "Break-glass event not found" }
  409: { code: "AUDIT_ALREADY_REVIEWED", message: "This break-glass event has already been reviewed" }
```

### DTOs

```typescript
interface AuditEventDto {
  id: string;
  tenantId: string;
  ts: string;               // ISO 8601
  actorId: string | null;
  actorIp: string | null;
  actorType: 'user' | 'system' | 'api_key' | 'break_glass';
  action: string;
  resourceType: string;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  metadata: AuditMetadataDto;
  signature: string;
}

interface AuditMetadataDto {
  correlationId: string;
  causationId: string;
  requestId?: string;
  userAgent?: string;
  sourceEventType: string;
  sourceEventId: string;
}

interface AuditStatDto {
  key: string;
  count: number;
  percentage: number;
}

interface AuditExportDto {
  exportId: string;
  status: 'processing' | 'ready' | 'failed';
  progress?: {
    eventsProcessed: number;
    estimatedTotal: number;
  };
  downloadUrl?: string;
  verificationHash?: string;
  chainVerified?: boolean;
  eventsCount?: number;
  format?: 'csv' | 'json';
  expiresAt?: string;
  errorMessage?: string;
}

interface BreakGlassAuditDto {
  id: string;
  tenantId: string;
  ts: string;
  actorId: string;
  actorIp: string;
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string;
  metadata: AuditMetadataDto;
  review: BreakGlassReviewDto | null;
  overdue: boolean;         // true if >24h since event and no review
}

interface BreakGlassReviewDto {
  reviewId: string;
  reviewedBy: string;
  decision: 'acknowledged' | 'escalated';
  comment: string;
  reviewedAt: string;
}

interface ChainVerificationDto {
  verified: boolean;
  eventsChecked: number;
  chainSegments: number;
  durationMs: number;
  firstBrokenLink: {
    eventId: string;
    ts: string;
    expectedSignature: string;
    actualSignature: string;
  } | null;
}
```

### Error Codes

| Code                          | HTTP Status | Description                                            |
| ----------------------------- | ----------- | ------------------------------------------------------ |
| AUDIT_EVENT_NOT_FOUND         | 404         | The requested audit event does not exist               |
| AUDIT_EXPORT_NOT_FOUND        | 404         | The requested export job does not exist                |
| AUDIT_EXPORT_FAILED           | 500         | The export job failed during processing                |
| AUDIT_CHAIN_BROKEN            | 200         | Chain verification detected a break (not an HTTP error)|
| AUDIT_QUERY_TIMEOUT           | 504         | Query exceeded the 30-second timeout                   |
| AUDIT_PARTITION_NOT_AVAILABLE | 503         | Requested time range includes detached cold partitions |
| AUDIT_ALREADY_REVIEWED        | 409         | Break-glass event has already been reviewed            |
| IAM_PERMISSION_DENIED         | 403         | Actor lacks the required permission                    |
| VALIDATION_ERROR              | 400         | Request body or query parameters failed validation     |

---

## 6. Events

### Standard Event Envelope

All events use the platform-wide envelope structure, serialized as JSON and published to NATS JetStream:

```typescript
interface DomainEvent<T = Record<string, unknown>> {
  /** UUIDv7 event ID */
  id: string;
  /** Dot-separated event type with version suffix */
  type: string;
  /** ISO 8601 timestamp of when the event occurred */
  occurredAt: string;
  /** Tenant context */
  tenantId: string;
  /** Actor who caused the event */
  actor: {
    type: 'user' | 'system' | 'api_key' | 'break_glass';
    id: string | null;
    ip: string | null;
  };
  /** Primary subject of the event */
  subject: {
    type: string;
    id: string;
  };
  /** For distributed tracing */
  correlationId: string;
  /** ID of the command/event that caused this event */
  causationId: string;
  /** Event-specific payload */
  data: T;
  /** JSON Schema URI for the data payload */
  schema: string;
}
```

### Events Consumed (Universal Consumer)

The Audit module subscribes to NATS JetStream subject `>` (wildcard for all subjects) on a dedicated consumer group `audit-writer`. Each domain event is mapped to an audit event row using the following extraction rules:

#### IAM Module Events

| Source Event                    | Audit Action                | Resource Type      | Before/After Extraction                                                              | Reason Required |
| ------------------------------- | --------------------------- | ------------------ | ------------------------------------------------------------------------------------ | --------------- |
| `iam.user.created.v1`          | `iam.user.created`          | `user`             | before: null, after: `{ email, fullName, clearance, status, roles: [] }`             | No              |
| `iam.user.updated.v1`          | `iam.user.updated`          | `user`             | before/after: extracted from `data.changes` (from/to for each changed field)         | No              |
| `iam.user.deactivated.v1`      | `iam.user.deactivated`      | `user`             | before: `{ status: 'active' }`, after: `{ status: 'disabled' }`, reason from data   | No              |
| `iam.role.assigned.v1`         | `iam.role.assigned`         | `user_role`        | before: null, after: `{ userId, roleId, roleCode, scope }`                           | Yes             |
| `iam.role.revoked.v1`          | `iam.role.revoked`          | `user_role`        | before: `{ userId, roleId, roleCode }`, after: null                                 | Yes             |
| `iam.session.opened.v1`        | `iam.session.opened`        | `session`          | before: null, after: `{ sessionId, ip, userAgent }`                                  | No              |
| `iam.session.closed.v1`        | `iam.session.closed`        | `session`          | before: `{ status: 'active' }`, after: `{ status: 'closed' }`, reason from data     | No              |
| `iam.breakglass.activated.v1`  | `iam.breakglass.activated`  | `breakglass_review`| before: null, after: `{ targetResource, targetRole, ttlHours }`, actor_type overridden to `break_glass` | Yes (MUST)      |
| `iam.policy.changed.v1`        | `iam.policy.changed`        | `policy`           | before/after: full policy snapshot from data                                         | No              |
| `iam.clearance.changed.v1`     | `iam.clearance.changed`     | `user`             | before: `{ clearance: old }`, after: `{ clearance: new }`, reason from data         | Yes             |
| `iam.mfa.enrolled.v1`          | `iam.mfa.enrolled`          | `user`             | before: `{ mfaEnabled: false }`, after: `{ mfaEnabled: true, mfaType }`             | No              |
| `iam.tenant.created.v1`        | `iam.tenant.created`        | `tenant`           | before: null, after: `{ code, name, region, status }`                                | No              |
| `iam.tenant.suspended.v1`      | `iam.tenant.suspended`      | `tenant`           | before: `{ status: 'active' }`, after: `{ status: 'suspended' }`, reason from data  | Yes             |

#### Incident Module Events

| Source Event                          | Audit Action                        | Resource Type | Before/After Extraction                                                    | Reason Required |
| ------------------------------------- | ----------------------------------- | ------------- | -------------------------------------------------------------------------- | --------------- |
| `incident.created.v1`                 | `incident.created`                  | `incident`    | before: null, after: `{ title, severity, status, type }`                   | No              |
| `incident.status_changed.v1`         | `incident.status_changed`           | `incident`    | before: `{ status: old }`, after: `{ status: new }`                        | No              |
| `incident.severity_changed.v1`       | `incident.severity_changed`         | `incident`    | before: `{ severity: old }`, after: `{ severity: new }`, reason from data | Yes             |
| `incident.commander_assigned.v1`     | `incident.commander_assigned`       | `incident`    | before: `{ commanderId: old }`, after: `{ commanderId: new }`             | No              |
| `incident.closed.v1`                  | `incident.closed`                   | `incident`    | before: `{ status: 'active' }`, after: `{ status: 'closed' }`, reason     | Yes             |
| `incident.reopened.v1`                | `incident.reopened`                 | `incident`    | before: `{ status: 'closed' }`, after: `{ status: 'active' }`, reason     | Yes             |

#### Task Module Events

| Source Event                  | Audit Action             | Resource Type | Before/After Extraction                                        | Reason Required |
| ----------------------------- | ------------------------ | ------------- | -------------------------------------------------------------- | --------------- |
| `task.created.v1`             | `task.created`           | `task`        | before: null, after: `{ title, incidentId, assigneeId }`      | No              |
| `task.assigned.v1`            | `task.assigned`          | `task`        | before: `{ assigneeId: old }`, after: `{ assigneeId: new }`   | No              |
| `task.status_changed.v1`     | `task.status_changed`    | `task`        | before: `{ status: old }`, after: `{ status: new }`           | No              |
| `task.completed.v1`           | `task.completed`         | `task`        | before: `{ status: 'in_progress' }`, after: `{ status: 'completed' }` | No    |

#### Document Module Events

| Source Event                   | Audit Action              | Resource Type | Before/After Extraction                                           | Reason Required |
| ------------------------------ | ------------------------- | ------------- | ----------------------------------------------------------------- | --------------- |
| `document.created.v1`          | `document.created`        | `document`    | before: null, after: `{ title, type, classification }`            | No              |
| `document.approved.v1`         | `document.approved`       | `document`    | before: `{ status: 'draft' }`, after: `{ status: 'approved' }`   | No              |
| `document.published.v1`        | `document.published`      | `document`    | before: `{ status: 'approved' }`, after: `{ status: 'published' }`| No             |
| `document.revoked.v1`          | `document.revoked`        | `document`    | before: `{ status: 'published' }`, after: `{ status: 'revoked' }`, reason | Yes    |

#### Communication Module Events

| Source Event                     | Audit Action                | Resource Type | Before/After Extraction                                                    | Reason Required |
| -------------------------------- | --------------------------- | ------------- | -------------------------------------------------------------------------- | --------------- |
| `chat.message.posted.v1`        | `chat.message.posted`       | `message`     | before: null, after: `{ channelId, messageType }` -- **message body NOT stored for privacy** | No |
| `chat.message.redacted.v1`      | `chat.message.redacted`     | `message`     | before: `{ status: 'visible' }`, after: `{ status: 'redacted' }`, reason  | Yes             |

#### File Module Events

| Source Event              | Audit Action         | Resource Type | Before/After Extraction                                              | Reason Required |
| ------------------------- | -------------------- | ------------- | -------------------------------------------------------------------- | --------------- |
| `file.uploaded.v1`        | `file.uploaded`      | `file`        | before: null, after: `{ filename, mimeType, sizeBytes, classification }` | No          |
| `file.scanned.v1`         | `file.scanned`       | `file`        | before: `{ scanStatus: 'pending' }`, after: `{ scanStatus, threats }` | No             |
| `file.deleted.v1`         | `file.deleted`       | `file`        | before: `{ filename, status }`, after: null                          | Yes             |

#### GIS Module Events

| Source Event                  | Audit Action            | Resource Type | Before/After Extraction                                    | Reason Required |
| ----------------------------- | ----------------------- | ------------- | ---------------------------------------------------------- | --------------- |
| `gis.layer.published.v1`     | `gis.layer.published`   | `layer`       | before: null, after: `{ layerName, type, featureCount }`   | No              |
| `gis.feature.created.v1`     | `gis.feature.created`   | `feature`     | before: null, after: `{ layerId, geometryType }`           | No              |

#### Audit Module Events (Self-Referential)

| Source Event                 | Audit Action              | Resource Type | Before/After Extraction                           | Reason Required |
| ---------------------------- | ------------------------- | ------------- | ------------------------------------------------- | --------------- |
| `audit.export.requested`     | `audit.export.requested`  | `export`      | before: null, after: `{ filters, format }`        | No              |
| `audit.chain.verified`       | `audit.chain.verified`    | `export`      | after: `{ verified, eventsChecked }`              | No              |

### Events Produced

#### audit.export.ready.v1

```typescript
{
  type: 'audit.export.ready.v1',
  subject: { type: 'export', id: '<export_id>' },
  data: {
    exportId: string;
    tenantId: string | null;
    format: 'csv' | 'json';
    downloadUrl: string;
    eventsCount: number;
    verificationHash: string;
    chainVerified: boolean;
  }
}
```

NATS subject: `audit.export.ready.v1`

#### audit.chain.broken.v1

```typescript
{
  type: 'audit.chain.broken.v1',
  subject: { type: 'audit_chain', id: '<tenant_id>' },
  data: {
    tenantId: string;
    firstBrokenEventId: string;
    firstBrokenTs: string;
    expectedSignature: string;
    actualSignature: string;
    eventsChecked: number;
  }
}
```

NATS subject: `audit.chain.broken.v1`

**Severity: CRITICAL.** This event triggers an immediate alert to all `platform_admin` users via the Notification module. Chain breaks indicate potential data tampering or a severe system malfunction.

### NATS Consumer Configuration

```typescript
const auditConsumerConfig = {
  stream: 'DOMAIN_EVENTS',
  durable: 'audit-writer',
  filterSubject: '>',           // Subscribe to ALL subjects
  ackPolicy: 'explicit',
  deliverPolicy: 'all',
  maxDeliver: 3,                // Retry up to 3 times
  ackWait: 30_000,              // 30-second ACK timeout
  maxAckPending: 10_000,        // Allow 10K unACKed messages for throughput
  replayPolicy: 'instant',
};
```

---

## 7. Database Schema

### Schema Setup

```sql
CREATE SCHEMA IF NOT EXISTS audit;

-- Required extensions (run in shared/public schema if not already present)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### audit.events (Partitioned)

```sql
CREATE TABLE audit.events (
    id            uuid          NOT NULL,
    tenant_id     uuid          NOT NULL,
    ts            timestamptz   NOT NULL DEFAULT now(),
    actor_id      uuid,
    actor_ip      inet,
    actor_type    text          NOT NULL
                                CHECK (actor_type IN ('user', 'system', 'api_key', 'break_glass')),
    action        text          NOT NULL
                                CHECK (action ~ '^[a-z]+\.[a-z_.]+$'),
    resource_type text          NOT NULL
                                CHECK (resource_type IN (
                                    'user', 'tenant', 'role', 'policy', 'session',
                                    'api_key', 'incident', 'task', 'document',
                                    'message', 'file', 'layer', 'feature',
                                    'export', 'breakglass_review', 'user_role'
                                )),
    resource_id   uuid          NOT NULL,
    before        jsonb,
    after         jsonb,
    reason        text,
    metadata      jsonb         NOT NULL DEFAULT '{}',
    signature     text          NOT NULL
                                CHECK (signature <> ''),

    PRIMARY KEY (id, ts),

    -- Actor ID is required for non-system actions
    CONSTRAINT events_actor_required
        CHECK (actor_type = 'system' OR actor_id IS NOT NULL),

    -- Break-glass actions must include a reason (min 10 chars)
    CONSTRAINT events_breakglass_reason
        CHECK (actor_type <> 'break_glass' OR (reason IS NOT NULL AND length(reason) >= 10)),

    -- Action length limit
    CONSTRAINT events_action_length
        CHECK (length(action) <= 200),

    -- Reason length limit
    CONSTRAINT events_reason_length
        CHECK (reason IS NULL OR length(reason) <= 2000)
) PARTITION BY RANGE (ts);

-- Create initial partitions (monthly)
-- pg_partman manages ongoing partition creation; these are the bootstrap partitions
CREATE TABLE audit.events_2026_01 PARTITION OF audit.events
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit.events_2026_02 PARTITION OF audit.events
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit.events_2026_03 PARTITION OF audit.events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit.events_2026_04 PARTITION OF audit.events
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit.events_2026_05 PARTITION OF audit.events
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit.events_2026_06 PARTITION OF audit.events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit.events_2026_07 PARTITION OF audit.events
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Default partition for events that don't match any partition range
-- (safety net; should never be used if pg_partman is healthy)
CREATE TABLE audit.events_default PARTITION OF audit.events DEFAULT;

-- Indexes (created on the parent; PostgreSQL propagates to partitions)
CREATE INDEX idx_events_tenant_ts ON audit.events (tenant_id, ts DESC);
CREATE INDEX idx_events_actor_ts ON audit.events (actor_id, ts DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_events_resource ON audit.events (resource_type, resource_id, ts DESC);
CREATE INDEX idx_events_action_ts ON audit.events (action, ts DESC);
CREATE INDEX idx_events_actor_type_ts ON audit.events (actor_type, ts DESC)
    WHERE actor_type = 'break_glass';
```

### pg_partman Configuration

```sql
-- Install pg_partman extension
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Configure automatic monthly partitioning
SELECT partman.create_parent(
    p_parent_table := 'audit.events',
    p_control := 'ts',
    p_type := 'range',
    p_interval := '1 month',
    p_premake := 3,          -- Pre-create 3 months ahead
    p_start_partition := '2026-01-01'
);

-- Configure retention (partitions older than 90 days are candidates for detachment)
UPDATE partman.part_config
SET retention = '90 days',
    retention_keep_table = true,    -- Don't DROP; we detach and export to cold storage
    infinite_time_partitions = true
WHERE parent_table = 'audit.events';

-- pg_partman maintenance should run every hour via pg_cron or external scheduler
-- SELECT partman.run_maintenance('audit.events');
```

### audit.exports

```sql
CREATE TABLE audit.exports (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid,
    requested_by      uuid        NOT NULL,
    filters           jsonb       NOT NULL,
    format            text        NOT NULL
                                  CHECK (format IN ('csv', 'json')),
    status            text        NOT NULL DEFAULT 'processing'
                                  CHECK (status IN ('processing', 'ready', 'failed')),
    events_count      bigint,
    file_path         text,
    download_url      text,
    verification_hash text,
    chain_verified    boolean,
    error_message     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    expires_at        timestamptz
);

CREATE INDEX idx_exports_tenant_id ON audit.exports (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_exports_requested_by ON audit.exports (requested_by);
CREATE INDEX idx_exports_status ON audit.exports (status) WHERE status = 'processing';
CREATE INDEX idx_exports_created_at ON audit.exports (created_at DESC);
```

### audit.breakglass_reviews

```sql
CREATE TABLE audit.breakglass_reviews (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    uuid        NOT NULL,
    event_ts    timestamptz NOT NULL,
    tenant_id   uuid        NOT NULL,
    reviewed_by uuid        NOT NULL,
    decision    text        NOT NULL
                            CHECK (decision IN ('acknowledged', 'escalated')),
    comment     text        NOT NULL
                            CHECK (length(comment) >= 10 AND length(comment) <= 2000),
    reviewed_at timestamptz NOT NULL DEFAULT now(),

    -- One review per break-glass event
    CONSTRAINT breakglass_reviews_unique_event UNIQUE (event_id)
);

CREATE INDEX idx_breakglass_reviews_tenant ON audit.breakglass_reviews (tenant_id, reviewed_at DESC);
CREATE INDEX idx_breakglass_reviews_event ON audit.breakglass_reviews (event_id);
```

### audit.partition_manifests

```sql
CREATE TABLE audit.partition_manifests (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    partition_name  text        NOT NULL UNIQUE,
    range_start     timestamptz NOT NULL,
    range_end       timestamptz NOT NULL,
    tier            text        NOT NULL CHECK (tier IN ('hot', 'warm', 'cold', 'destroyed')),
    events_count    bigint      NOT NULL,
    sha256_hash     text        NOT NULL,
    s3_path         text,
    detached_at     timestamptz,
    destroyed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partition_manifests_tier ON audit.partition_manifests (tier);
CREATE INDEX idx_partition_manifests_range ON audit.partition_manifests (range_start, range_end);
```

### audit.signature_keys

```sql
-- Tracks HMAC signing key versions for rotation
CREATE TABLE audit.signature_keys (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    version     integer     NOT NULL UNIQUE,
    key_ref     text        NOT NULL,   -- Reference to the key in secrets manager (NOT the key itself)
    active      boolean     NOT NULL DEFAULT true,
    activated_at timestamptz NOT NULL DEFAULT now(),
    rotated_at  timestamptz           -- Set when this key is rotated out
);

CREATE UNIQUE INDEX idx_signature_keys_active ON audit.signature_keys (active) WHERE active = true;
```

### Row-Level Security (RLS)

```sql
-- Enable RLS on audit.events
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: users can only see events for their tenant
CREATE POLICY tenant_isolation ON audit.events
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Platform admins and auditors can see all tenants (bypass RLS)
-- This is handled by the application layer setting app.current_tenant_id
-- to a special value or by using the audit_role which has BYPASSRLS

-- RLS on exports
ALTER TABLE audit.exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_exports ON audit.exports
    FOR SELECT
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS on breakglass_reviews
ALTER TABLE audit.breakglass_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_reviews ON audit.breakglass_reviews
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### Permission Grants

```sql
-- Application role: INSERT and SELECT only on events. NO UPDATE, NO DELETE.
REVOKE ALL ON audit.events FROM PUBLIC;
REVOKE ALL ON audit.events FROM app_role;
GRANT INSERT, SELECT ON audit.events TO app_role;

-- Explicitly revoke UPDATE and DELETE (defense in depth)
REVOKE UPDATE, DELETE ON audit.events FROM app_role;

-- Audit read-only role for external auditors
REVOKE ALL ON audit.events FROM audit_role;
GRANT SELECT ON audit.events TO audit_role;
GRANT SELECT ON audit.exports TO audit_role;
GRANT SELECT ON audit.breakglass_reviews TO audit_role;

-- Application role needs full CRUD on supporting tables
GRANT INSERT, SELECT, UPDATE ON audit.exports TO app_role;
GRANT INSERT, SELECT ON audit.breakglass_reviews TO app_role;
GRANT SELECT ON audit.partition_manifests TO app_role;
GRANT INSERT, UPDATE ON audit.partition_manifests TO app_role;
GRANT SELECT, INSERT ON audit.signature_keys TO app_role;
GRANT UPDATE (active, rotated_at) ON audit.signature_keys TO app_role;

-- Prevent any role from adding UPDATE/DELETE grants on audit.events
-- (This is enforced by a PostgreSQL event trigger)
CREATE OR REPLACE FUNCTION audit.prevent_dangerous_grants()
RETURNS event_trigger AS $$
DECLARE
    obj record;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    LOOP
        IF obj.command_tag = 'GRANT' AND obj.object_identity LIKE '%audit.events%' THEN
            RAISE EXCEPTION 'Granting UPDATE or DELETE on audit.events is prohibited';
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Note: event triggers for GRANT monitoring require superuser setup
-- and should be configured during initial database provisioning.
```

### Transactional Outbox (for Audit-Produced Events)

```sql
CREATE TABLE audit.outbox (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type   text        NOT NULL,
    payload      jsonb       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX idx_outbox_unpublished ON audit.outbox (created_at)
    WHERE published_at IS NULL;

GRANT INSERT, SELECT, UPDATE ON audit.outbox TO app_role;
```

---

## 8. Permissions

### Permission Definitions

| Permission Code              | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `audit.read`                 | Read audit events (scoped to tenant for tenant_admin)|
| `audit.export`               | Request audit log exports                            |
| `audit.verify`               | Run HMAC chain verification                          |
| `audit.breakglass.review`    | View and review break-glass audit events             |
| `audit.admin`                | Full audit administration (partition management)     |

### Role-Permission Mapping

| Role            | Permissions                                                                   | Scope             |
| --------------- | ----------------------------------------------------------------------------- | ----------------- |
| `auditor`       | `audit.read`, `audit.export`, `audit.verify`                                 | All tenants       |
| `platform_admin`| `audit.read`, `audit.export`, `audit.verify`, `audit.breakglass.review`, `audit.admin` | All tenants |
| `tenant_admin`  | `audit.read`                                                                  | Own tenant only   |
| `shift_lead`    | `audit.breakglass.review`                                                     | Own tenant only   |

### Audit-of-Audit

Every read access to the audit log via the API generates an audit event:

- `action = 'audit.read'`
- `resource_type = 'export'` (for the logical concept of audit data access)
- `metadata` includes the query parameters used

This ensures that even access to the audit log is traceable. The single exception is described in the Edge Cases section: `audit.read` events themselves are not recursively audited.

### Break-Glass Review SLA

Break-glass events (`actor_type = 'break_glass'`) must be reviewed within 24 hours. The system enforces this through:

1. A scheduled job (every hour) that identifies unreviewed break-glass events older than 24 hours.
2. Escalation notifications sent to all `platform_admin` users and the `shift_lead` for the affected tenant.
3. The `GET /api/v1/audit/breakglass` endpoint flags overdue events with `overdue: true`.
4. Repeated escalation every 4 hours until the event is reviewed.

---

## 9. Edge Cases

### Failure Scenarios

#### HMAC Chain Break Detected

- **Detection**: During chain verification (manual or during export), a signature mismatch is found.
- **Response**: Emit `audit.chain.broken.v1` (CRITICAL alert). Alert all `platform_admin` users via the Notification module. The alert includes the event ID and timestamp of the first broken link.
- **Continuation**: Writes do NOT stop. New events continue with a fresh chain segment. The new segment starts with the genesis signature. The break point is recorded in the chain verification report.
- **Investigation**: The security team must determine whether the break was caused by data tampering, a software bug, or a key rotation anomaly. The investigation itself is audited.

#### High Volume Burst (20K Events/Second)

- **Detection**: NATS consumer lag exceeds 10,000 messages.
- **Response**: The consumer automatically switches to batch mode. Events are accumulated in memory (max 1,000 per batch) and inserted using a multi-row INSERT or PostgreSQL COPY protocol.
- **Batch signature computation**: Signatures are computed sequentially within each batch to maintain chain integrity. The batch is inserted in a single transaction.
- **Horizontal scaling**: Multiple NATS consumer instances can run concurrently. Each instance handles a subset of partitions (by tenant_id hash). Chain signatures are per-tenant, so parallel consumers do not conflict.
- **Backpressure**: If the consumer cannot keep up despite batching, NATS JetStream's `maxAckPending` limit (10,000) provides natural backpressure. Publishers are not affected because they write to the outbox table, not directly to NATS.

#### Partition Not Yet Created for Current Month

- **Detection**: INSERT fails with a routing error, or rows land in the `audit.events_default` partition.
- **Response**: A monitoring query checks the default partition hourly. If any rows are found, an alert is fired. pg_partman's `run_maintenance()` is invoked immediately to create missing partitions.
- **Prevention**: pg_partman pre-creates partitions 3 months in advance. The maintenance job runs every hour via pg_cron. A separate monitoring check verifies that the next 3 months of partitions exist and alerts if any are missing.

#### Cold Partition Needed for Investigation

- **Request**: An administrator needs to query data older than 2 years for an investigation.
- **Flow**: Administrator calls `RestorePartition` with the partition name and a reason. The Parquet file is downloaded from S3, loaded into a temporary table, and attached as a read-only partition. A background timer detaches it after 72 hours.
- **Concurrency**: Only one restore operation per partition at a time (enforced by a Redis lock on `audit:restore:{partition_name}`).
- **Timeout**: If the restore takes longer than 30 minutes (large partition), the operation is aborted and the administrator is notified.

#### INSERT Failure (Database Unavailable)

- **Response**: The NATS message is NACKed with a backoff delay (1s, 5s, 30s). After 3 failures, the event is routed to the dead-letter queue `audit.dlq`.
- **DLQ processing**: A separate consumer reads from `audit.dlq` every 60 seconds and retries INSERTs. Events in the DLQ for more than 1 hour trigger an alert.
- **Data integrity**: The DLQ ensures no audit events are silently lost. The chain signature for DLQ events is computed at the time of successful INSERT, which means there may be a gap in the chain at the original timestamp. This gap is annotated in verification reports as "late arrival".

### Concurrency Issues

#### Parallel NATS Consumers Computing Signatures

- **Problem**: If two consumer instances simultaneously compute signatures for the same tenant, the chain will fork.
- **Solution**: Chain signatures are scoped per tenant. Each tenant's last signature is stored in Redis (`audit:last_signature:{tenant_id}`) with a Lua script that atomically reads the previous signature and writes the new one:

```lua
-- Redis Lua script: atomic signature chain update
local key = KEYS[1]
local new_signature = ARGV[1]
local prev = redis.call('GET', key)
if prev == false then
    prev = '0000000000000000000000000000000000000000000000000000000000000000'
end
redis.call('SET', key, new_signature)
return prev
```

- Additionally, NATS consumer partitioning ensures that events for a given tenant are always processed by the same consumer instance (using `tenant_id` as the partition key in NATS key-value consumer configuration).

#### Concurrent Export Requests for Same Data Range

- **Response**: Each export creates a separate `audit.exports` row and runs independently. No deduplication is attempted because different actors may need separate signed export files for their compliance records.

### Recursion Prevention

#### Audit-of-Audit Infinite Loop

- **Problem**: Reading audit events creates an `audit.read` event. If that event is then read, it creates another `audit.read` event, ad infinitum.
- **Solution**: Events with `action = 'audit.read'` are excluded from the audit-of-audit mechanism. When the API handler detects that the current request is an audit read, it still creates the `audit.read` event, but the NATS consumer has an explicit filter that skips creating a recursive audit event for `audit.read` actions.
- **Alternative tracking**: Access to audit data is additionally logged to a lightweight access log table (`audit.access_log`) that is not part of the HMAC chain and is retained for 90 days only. This provides a secondary record of audit access without chain overhead.

```sql
CREATE TABLE audit.access_log (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid        NOT NULL,
    actor_id    uuid        NOT NULL,
    query_params jsonb      NOT NULL,
    ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_log_ts ON audit.access_log (ts DESC);
GRANT INSERT, SELECT ON audit.access_log TO app_role;
```

### Clock Skew Between Application Nodes

- **Problem**: If application nodes have different system clocks, the `ts` field could be inconsistent with ordering expectations.
- **Solution**: The `ts` column uses `DEFAULT now()` which is evaluated by the PostgreSQL server, not the application. All INSERTs rely on the database server's clock. The application never provides a `ts` value. This is enforced by excluding `ts` from the application's INSERT column list.

### Signature Key Rotation

- **Trigger**: Key rotation is initiated by a platform administrator or by an automated policy (e.g., every 90 days).
- **Flow**: Generate new HMAC key in secrets manager -> insert new row into `audit.signature_keys` with `active = true` -> set previous key's `active = false` and `rotated_at = now()` -> update the NATS consumer to use the new key -> the chain continues with the new key; the transition is seamless because the chain links through signatures, not through keys.
- **Verification**: When verifying the chain, the verifier must use the correct key for each segment. The `audit.signature_keys` table maps key versions to time ranges (based on `activated_at` and `rotated_at`). The verifier looks up the correct key for each event's timestamp.
- **Audit**: The key rotation itself is recorded as an audit event (`action = 'audit.key_rotated'`, `resource_type = 'export'`).

### OpenSearch Index Lag

- **Problem**: The OpenSearch index may lag behind PostgreSQL, causing search results to miss recent events.
- **Solution**: The search API response includes a `lagWarning` field when the most recent indexed event is more than 60 seconds old. Clients are advised to use the filter-based `ListAuditEvents` endpoint for real-time queries and reserve `SearchAuditEvents` for full-text searches where slight lag is acceptable.

### Export of Extremely Large Datasets

- **Problem**: An export request covering years of data for a large tenant could produce billions of rows.
- **Guardrails**:
  - Maximum export time range: 365 days per request. Longer ranges require multiple export requests.
  - Maximum rows per export: 50 million. If the estimated count exceeds this, the request is rejected with a `VALIDATION_ERROR` suggesting the user narrow the filters.
  - Streaming export: rows are streamed from PostgreSQL via a server-side cursor, transformed, and written to MinIO in 100 MB chunks. Memory usage is bounded to approximately 256 MB per export worker.
  - Export workers have a 2-hour timeout. Exports exceeding this are marked as `failed` with an appropriate error message.
