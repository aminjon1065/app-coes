# Sentinel -- National Disaster Management Platform: System Design

> **Version:** 1.0.0
> **Date:** 2026-04-12
> **Status:** Approved
> **Classification:** INTERNAL
> **Audience:** Engineering, DevOps, Security, Architecture Review Board

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architectural Style](#2-architectural-style)
3. [System Topology](#3-system-topology)
4. [Sync vs Async Decision Matrix](#4-sync-vs-async-decision-matrix)
5. [BFF Layer](#5-bff-layer)
6. [Data Layer Architecture](#6-data-layer-architecture)
7. [Security Architecture](#7-security-architecture)
8. [Resilience Patterns](#8-resilience-patterns)
9. [Observability](#9-observability)
10. [Cross-Cutting Concerns](#10-cross-cutting-concerns)
11. [Repository Structure](#11-repository-structure)
12. [Decision Log](#12-decision-log)

---

## 1. System Overview

### 1.1 Mission

Sentinel is the operational nervous system of a national civil protection agency (KChS-class). It serves as the primary coordination platform during emergencies -- earthquakes, floods, CBRN incidents, wildfires, mass casualty events -- and in peacetime for drills, planning, resource management, and post-incident analysis.

The defining constraint is **time-to-decision under stress**. When a 7.0 earthquake strikes at 03:00, the Incident Commander has seconds, not minutes, to assess scope, allocate resources, and issue orders. Every screen must be glanceable in under 3 seconds. Every action must be reachable in under 2 clicks. Every data feed must be live and trustworthy.

Sentinel replaces fragmented tooling (spreadsheets, radio logs, whiteboards, paper maps) with a unified digital operating picture that spans the full incident lifecycle:

- **Detection** -- ingest seismic, hydrological, meteorological, and CBRN sensor feeds
- **Alert** -- notify duty officers, escalate per severity protocol
- **Mobilization** -- dispatch units, open resource requests, activate mutual aid
- **Response** -- command and control via live map, task boards, voice/video, chat
- **Recovery** -- damage assessment, situation reports, resource demobilization
- **Analysis** -- after-action review, trend analytics, drill scenario replay

The platform is designed for sovereign deployment: fully operational on-premise in air-gapped environments, with no dependency on public cloud services.

### 1.2 Non-Functional Targets

| Category | Metric | Target | Measurement Method |
|---|---|---|---|
| **Latency** | p50 API read | < 80 ms | OpenTelemetry span histogram |
| | p95 API read | < 250 ms | OpenTelemetry span histogram |
| | p99 API write | < 600 ms | OpenTelemetry span histogram |
| | WebSocket fan-out (event publish to client receipt) | < 500 ms | Custom instrumentation |
| | Map tile render (cached) | < 200 ms | Browser performance marks |
| **Throughput** | Concurrent operators (authenticated sessions) | 5,000 | Load test (k6) |
| | Concurrent WebSocket connections | 50,000 | Load test (k6 + ws) |
| | Events/sec (peak sustained) | 20,000 | NATS metrics |
| | Simultaneously open incidents | 10,000 | Application metrics |
| **Availability** | Core (Incident, IAM, Realtime) | 99.95% (< 26 min/year) | Uptime monitoring |
| | Analytics | 99.5% (< 44 h/year) | Uptime monitoring |
| | RPO (Recovery Point Objective) | ≤ 60 s | WAL lag monitoring |
| | RTO (Recovery Time Objective) | ≤ 15 min | DR drill measurement |
| **Scale** | Total documents | 100 M | PostgreSQL + MinIO metrics |
| | Audit events per year | 5 B | Partitioned table counts |
| | Map features (live overlay) | 1 M | PostGIS + frontend profiling |
| **Security** | Classification levels | 4 (PUBLIC / INTERNAL / CONFIDENTIAL / SECRET) | Policy enforcement tests |
| | MFA coverage | 100% for privileged users | IAM audit report |
| | Audit retention | 7 years | Backup lifecycle policy |

These targets are validated continuously via automated load tests in staging (weekly) and production canary deployments (per release).

---

## 2. Architectural Style

### 2.1 Phase 1 -- Modular Monolith

The system ships as a single NestJS deployment containing 10 bounded contexts, each implemented as a NestJS module with strict isolation:

| Module | Prefix | Responsibility |
|---|---|---|
| **IAM** | `iam_` | Identity, authentication, authorization, RBAC/ABAC, sessions, audit trails for access |
| **Incident** | `inc_` | Incident lifecycle, severity, status, ICS structure, situational awareness |
| **Task** | `task_` | Task assignment, tracking, SLA, checklists, dependencies |
| **Document** | `doc_` | Situation reports, SOPs, templates, version control, PDF generation |
| **Communication** | `chat_` | Chat channels (per-incident, per-team, direct), message history, presence |
| **GIS** | `gis_` | Map layers, feature management, spatial queries, tile serving, geofencing |
| **File** | `file_` | Upload, download, virus scanning, thumbnailing, content addressing |
| **Analytics** | `fact_`/`dim_` | Star-schema data warehouse, ETL pipelines, dashboards, KPIs |
| **Notification** | `notif_` | Multi-channel dispatch (push, SMS, email, in-app), templates, delivery tracking |
| **Audit** | `audit_` | Immutable event log, compliance queries, data retention enforcement |

**Internal communication** uses an in-process `EventBus` (NestJS `EventEmitter2`) for fire-and-forget domain events within the monolith process.

**External communication** uses NATS JetStream for durable, replayable events that cross process boundaries (workers, realtime gateway, SFU, external consumers).

**Boundary enforcement** is achieved through:
- ESLint architectural rules that forbid imports across module boundaries (except via published contracts)
- Nx project graph that models module dependencies and enforces acyclic constraints
- CI pipeline that fails on boundary violations

### 2.2 Phase 2 -- Selective Extraction (Year 2+)

Modules are extracted to independent services **only** when there is a proven, measurable need:

| Candidate | Trigger | Rationale |
|---|---|---|
| `realtime-gateway` | WS connections exceed single-node capacity | WebSocket connections are long-lived and memory-heavy; 50K connections require horizontal scaling independent of API compute |
| `mediasoup-sfu` | CPU contention during simultaneous video calls | Media processing is CPU-bound and contends with request handling; isolation prevents voice/video from degrading API latency |
| `analytics-etl` | Independent deploy cadence, scaling of consumers | ETL jobs are bursty, long-running, and benefit from scaling independently without affecting request-serving capacity |

**NON-NEGOTIABLE RULE:** No premature microservices. The cost of distributed systems (network partitions, distributed transactions, operational complexity, debugging difficulty) is only justified by measured, concrete scaling or organizational constraints. Until then, the modular monolith provides the same logical separation with dramatically simpler operations.

### 2.3 Module Boundary Rules

These rules are the foundation of the architecture. They make future extraction possible while keeping present-day development simple:

1. **Each module owns its database tables.** Tables are prefixed by module (`iam_users`, `inc_incidents`, `task_tasks`, etc.). No module may read or write another module's tables.

2. **Each module owns its REST surface.** Routes are namespaced (`/api/v1/iam/*`, `/api/v1/incidents/*`, etc.). No module registers routes for another module's domain.

3. **Each module owns its events.** Event types are namespaced (`iam.user.created`, `incident.status.changed`, `task.assigned`, etc.). Only the owning module may publish events for its domain.

4. **Cross-context joins are forbidden in application code.** If module A needs data from module B, it either subscribes to B's events and maintains a local read model, or calls B's public API.

5. **Read models are projected via events.** When a module needs denormalized views of another module's data, it subscribes to events and maintains its own materialized projection.

6. **Communication uses EventBus (in-process) or NATS (external).** A REST handler may synchronously return a response and then asynchronously emit an event. It must never synchronously call another module's service class or repository.

Enforcement is automated:
```
// eslint rule (simplified)
// @sentinel/no-cross-module-import
"rules": {
  "@sentinel/no-cross-module-import": ["error", {
    "allow": ["@sentinel/contracts/*"]
  }]
}
```

---

## 3. System Topology

### 3.1 Architecture Diagram

```
                        +-------------------+
                        |     Clients       |
                        | Web (Next.js PWA) |
                        | Mobile (PWA)      |
                        +--------+----------+
                                 |
                         HTTPS / WSS / WebRTC
                                 |
                    +------------v-------------+
                    |    Edge (Nginx/Envoy)     |
                    | TLS 1.3 termination       |
                    | WAF (ModSecurity/Coraza)  |
                    | Rate limiting (L7)        |
                    | mTLS to internal services |
                    +---+-------+--------+-----+
                        |       |        |
           +------------+   +---+----+   +-------------+
           |                |        |                  |
  +--------v-------+ +-----v------+ +--------v--------+
  |    BFF Layer   | |API Gateway | |Realtime Gateway  |
  | Next.js Server | | (NestJS)   | | (Socket.IO +     |
  | Components +   | | REST/OAS3  | |  Redis Adapter)  |
  | API Routes     | | IAM guard  | | NATS consumer    |
  | SSR, cookies,  | | rate limit | | presence mgmt    |
  | aggregation    | | audit log  | | 50K connections  |
  +--------+-------+ +-----+------+ +--------+--------+
           |                |                 |
           +--------+-------+---------+-------+
                    |                 |
          +---------v-----------------v---------+
          |    Application Core (NestJS)        |
          |                                     |
          | +-----+ +--------+ +------+ +-----+|
          | | IAM | |Incident| | Task | | Doc ||
          | +-----+ +--------+ +------+ +-----+|
          | +-----+ +------+ +------+ +-------+|
          | | GIS | | File | | Chat | | Audit ||
          | +-----+ +------+ +------+ +-------+|
          | +----------+ +--------------+       |
          | | Analytics| | Notification |       |
          | +----------+ +--------------+       |
          | +----------------------------------+|
          | |       Domain EventBus            ||
          | | (EventEmitter2 in-process)       ||
          | +----------------------------------+|
          +---+--------+--------+--------+------+
              |        |        |        |
     +--------v--+ +---v---+ +-v------+ +v-----------+
     |PostgreSQL  | |Redis 7| | MinIO  | |OpenSearch  |
     |16+PostGIS  | |       | | (S3)   | |            |
     |3.4         | |cache  | | WORM   | |full-text   |
     |partitioned | |pubsub | | audit  | |logs        |
     |RLS         | |presence| |encrypt| |aggregation |
     +------------+ +---+---+ +--------+ +------------+
                         |
              +----------v-----------+
              |  NATS JetStream      |
              |  durable streams     |
              |  DLQ, replay         |
              |  cross-process bus   |
              +--+--------+----+----+
                 |        |    |
        +--------v-+ +---v--+ +v-----------+
        | Workers  | | SFU  | | External   |
        | (NestJS) | |media-| | Integrations|
        |          | |soup  | |            |
        | ETL      | |voice/| | seismic    |
        | notif    | |video | | 112/phone  |
        | PDF gen  | |record| | SMS GW     |
        | OCR      | |FFmpeg| | weather    |
        | AV scan  | |→MinIO| | ministry   |
        +----------+ +------+ | SSO/OIDC   |
                               | map tiles  |
                               +------------+
```

### 3.2 Network Zones

The deployment is segmented into four trust boundaries, each with distinct security controls:

**Public Zone (DMZ)**
- Components: Edge proxy (Nginx/Envoy), BFF (Next.js)
- Exposure: Internet-facing via HTTPS/WSS only
- Controls: TLS 1.3 termination, WAF rules, DDoS protection, rate limiting at L7, no direct database access
- Hardening: Minimal base image, read-only filesystem, no shell access

**Internal Zone (Application)**
- Components: API Gateway, Application Core, Realtime Gateway, Workers, SFU
- Exposure: Accessible only from Public Zone via mTLS
- Controls: Service mesh identity (SPIFFE/SPIRE), JWT validation, RBAC enforcement, request tracing
- Hardening: NetworkPolicies (default-deny ingress/egress, explicit allow-list per service), seccomp profiles, non-root containers

**Data Zone (Persistence)**
- Components: PostgreSQL, Redis, MinIO, OpenSearch, NATS
- Exposure: Accessible only from Internal Zone, never from Public Zone
- Controls: mTLS client certificates, authentication required on all services, encrypted at rest, dedicated network segment
- Hardening: No external network access, encrypted volume mounts, backup encryption

**External Zone (Integrations)**
- Components: Seismic feeds (FDSN), 112 telephony (SIP), SMS gateway, weather APIs, ministry registries, tile servers, SSO providers
- Exposure: Outbound only from Internal Zone via dedicated egress proxies
- Controls: Circuit breakers, timeouts, IP allowlists, API key rotation, response validation

**Network Policy Summary:**
```yaml
# Default deny all ingress and egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Each service declares explicit ingress/egress rules. Examples:
- `api-gateway` ingress: from `edge-proxy` on port 3000
- `api-gateway` egress: to `postgresql` on 5432, `redis` on 6379, `nats` on 4222
- `postgresql` ingress: from `api-gateway`, `workers` on port 5432 only
- `postgresql` egress: to replication peer only

---

## 4. Sync vs Async Decision Matrix

| Operation | Style | Rationale |
|---|---|---|
| User reads (list, get, search) | **Sync REST** | Latency-critical; operator expects immediate response; transactional consistency required |
| User writes affecting own UI (create incident, update task) | **Sync REST + emit event after commit** | Operator needs immediate confirmation that write succeeded; side effects propagate asynchronously |
| Cross-domain side effects (incident created triggers task template, notification, audit) | **Async via NATS** | Decoupled modules; failure in notification must not block incident creation; independently retryable |
| Realtime fan-out (incident status change to 200 viewers) | **WebSocket consumed from NATS** | Single source of truth (NATS stream); realtime gateway fans out to connected clients; scales horizontally |
| Heavy compute (PDF generation, OCR, AV scan, ETL) | **Async worker via NATS** | Never block the request thread; long-running operations run in dedicated worker pods with separate resource limits |
| External integrations (seismic feed, SMS dispatch, weather) | **Async with circuit breaker** | Third-party latency and availability must not degrade core platform; circuit breaker prevents cascade failure |

**Hard rule:** A REST handler may publish events but must NEVER await a downstream subscriber's completion. The request returns after its own transaction commits. Any downstream processing failure is handled via retry, DLQ, and alerting -- never by blocking the user.

**Event publishing pattern:**
```typescript
// Correct: publish after transaction commit
async createIncident(dto: CreateIncidentDto): Promise<Incident> {
  const incident = await this.db.transaction(async (tx) => {
    const inc = await tx.insert(incidents).values(dto).returning();
    await tx.insert(outbox).values({
      aggregateType: 'incident',
      aggregateId: inc.id,
      eventType: 'incident.created',
      payload: inc,
    });
    return inc;
  });
  // Outbox poller publishes to NATS -- never inline await
  return incident;
}
```

---

## 5. BFF Layer

### 5.1 Design

The Next.js application serves as both the frontend rendering layer and a Backend-for-Frontend (BFF) that mediates between the browser and internal services:

**Responsibilities:**
- Server-side rendering via React Server Components for initial page loads
- Session management: access tokens (10 min JWT) and refresh tokens (8 h opaque) stored in HTTP-only, Secure, SameSite=Strict cookies
- Request aggregation: each page load triggers a single BFF call that fans out to 2-5 backend services over internal HTTP/2 with mTLS, then assembles a unified response
- Token refresh: transparently rotates tokens before expiry, client never handles JWT lifecycle
- CSRF protection via double-submit cookie pattern
- Content Security Policy headers

**Security invariants:**
- The browser never communicates directly with PostgreSQL, Redis, NATS, MinIO, or any internal service
- JWTs are never stored in localStorage or sessionStorage
- The BFF validates and sanitizes all inputs before forwarding to backend services
- Server Components fetch data at the edge of the request; Client Components receive pre-validated props

**Internal communication:**
```
Browser ──HTTPS──> Next.js (BFF)
                      │
                      ├──HTTP/2 + mTLS──> API Gateway ──> Application Core
                      ├──HTTP/2 + mTLS──> API Gateway ──> Application Core
                      └──HTTP/2 + mTLS──> API Gateway ──> Application Core
                      │
                      └── Assembles response ──> Server-rendered HTML + RSC payload
```

### 5.2 Page Aggregation Examples

Each page is designed to minimize round-trips between browser and server. The BFF assembles all required data in a single server-side pass:

**Dashboard Page (1 BFF call, 4 backend calls):**
```typescript
// app/dashboard/page.tsx (Server Component)
async function DashboardPage() {
  const [incidents, tasks, stats, mapPreview] = await Promise.all([
    api.incidents.listActive({ limit: 20 }),
    api.tasks.listMine({ status: 'PENDING', limit: 10 }),
    api.analytics.dashboardStats(),
    api.gis.mapPreview({ bounds: userDefaultBounds }),
  ]);
  return <DashboardView incidents={incidents} tasks={tasks} stats={stats} map={mapPreview} />;
}
```

**Incident Detail Page (1 BFF call, 5 backend calls):**
```typescript
async function IncidentPage({ params }: { params: { id: string } }) {
  const [incident, tasks, chatPreview, layers, timeline] = await Promise.all([
    api.incidents.get(params.id),
    api.tasks.listByIncident(params.id, { limit: 50 }),
    api.chat.channelPreview(params.id),
    api.gis.incidentLayers(params.id),
    api.incidents.timeline(params.id, { limit: 100 }),
  ]);
  return (
    <IncidentView
      incident={incident}
      tasks={tasks}
      chat={chatPreview}
      layers={layers}
      timeline={timeline}
    />
  );
}
```

**Task Board Page (1 BFF call, 3 backend calls):**
```typescript
async function TaskBoardPage({ params }: { params: { incidentId: string } }) {
  const [tasks, incident, participants] = await Promise.all([
    api.tasks.listByIncident(params.incidentId),
    api.incidents.summary(params.incidentId),
    api.iam.incidentParticipants(params.incidentId),
  ]);
  return <TaskBoard tasks={tasks} incident={incident} participants={participants} />;
}
```

**Performance budget:** BFF aggregation must complete within 400 ms (p95). If any backend call exceeds 300 ms, it is logged as slow and considered for caching or precomputation.

---

## 6. Data Layer Architecture

### 6.1 PostgreSQL Strategy

PostgreSQL 16 with PostGIS 3.4 is the system of record.

**Multi-tenancy:**
- Every table includes a `tenant_id UUID NOT NULL` column
- Row-Level Security (RLS) policies on every table enforce tenant isolation at the database level
- At the start of every transaction, the application executes `SET LOCAL app.tenant_id = '<uuid>'`
- RLS policies reference `current_setting('app.tenant_id')` to filter rows
- Platform administrators use a privileged database role that bypasses RLS, with every such access producing a dedicated audit row

```sql
-- Example RLS policy
ALTER TABLE inc_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inc_incidents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY platform_admin_bypass ON inc_incidents
  USING (current_setting('app.is_platform_admin', true)::boolean = true);
```

**Extensions:**
| Extension | Purpose |
|---|---|
| `uuid-ossp` | UUID generation (fallback) |
| `pgcrypto` | Cryptographic functions for field-level encryption |
| `postgis` | Spatial data types, spatial queries, geometry operations |
| `pg_trgm` | Trigram-based fuzzy text search (fallback when OpenSearch unavailable) |
| `btree_gist` | GiST index support for exclusion constraints (e.g., temporal ranges) |
| `pg_stat_statements` | Query performance monitoring |
| `pg_partman` | Automated partition management |

**Schema organization:**

Each bounded context owns a PostgreSQL schema:
```
iam          -- iam_users, iam_roles, iam_permissions, iam_sessions, iam_mfa_devices
incident     -- inc_incidents, inc_timeline, inc_resources, inc_ics_assignments
task         -- task_tasks, task_checklists, task_checklist_items, task_dependencies
document     -- doc_documents, doc_versions, doc_templates
chat         -- chat_channels, chat_messages, chat_participants, chat_reactions
gis          -- gis_layers, gis_features, gis_tile_cache, gis_geofences
file         -- file_objects, file_thumbnails, file_scan_results
analytics    -- fact_incidents, fact_responses, dim_region, dim_hazard, dim_time
audit        -- audit_events
notification -- notif_templates, notif_deliveries, notif_preferences
```

**Primary key strategy:**

UUIDv7 for all primary keys. UUIDv7 embeds a Unix timestamp in the high bits, making it both globally unique and time-ordered, which dramatically improves B-tree index locality compared to UUIDv4.

```sql
-- UUIDv7 generation function (polyfill until PostgreSQL 18 adds native support)
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  -- Set version 7
  uuid_bytes = set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  -- Set variant 2
  uuid_bytes = set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
```

**Conventions:**
- `snake_case` for all identifiers
- Plural table names (`iam_users`, not `iam_user`)
- Every table includes: `id UUID PRIMARY KEY DEFAULT uuidv7()`, `tenant_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at` maintained via trigger
- Soft deletes via `deleted_at TIMESTAMPTZ` where required (never for audit)

**Partitioning:**

High-volume tables are range-partitioned by month using `pg_partman`:

| Table | Partition Key | Retention | Rationale |
|---|---|---|---|
| `inc_timeline` | `created_at` | 5 years online, 10 years archive | High write volume during incidents |
| `chat_messages` | `created_at` | 2 years online, 7 years archive | Chat is highest-volume write path |
| `audit_events` | `created_at` | 7 years online (compliance) | 5B events/year; must remain queryable for compliance |

```sql
SELECT partman.create_parent(
  p_parent_table := 'audit.audit_events',
  p_control := 'created_at',
  p_type := 'range',
  p_interval := '1 month',
  p_premake := 3
);
```

### 6.2 Connection Management

Database connections are managed via `pgBouncer` in transaction mode, with per-module pool caps to implement bulkhead isolation:

| Pool | Max Connections | Purpose |
|---|---|---|
| `api_primary` | 80 | API Gateway writes and reads |
| `api_replica` | 40 | Analytics queries, search fallback |
| `worker` | 20 | Background job processing |
| `realtime` | 20 | Presence, channel membership |

**Bulkhead behavior:** If the `worker` pool is exhausted, background jobs queue up but API requests continue unimpeded. If `api_primary` exhaustion is detected (>90% utilization for 10s), new requests receive HTTP 503 immediately rather than queueing -- fail fast, don't cascade.

**Read replicas:** Analytics and search-fallback queries are routed to streaming replicas. The application marks query intent via a `@ReadReplica()` decorator:

```typescript
@ReadReplica()
async getIncidentStats(tenantId: string): Promise<IncidentStats> {
  // Automatically routed to replica pool
}
```

### 6.3 Redis Strategy

Redis 7 serves multiple distinct roles, each using a separate logical database or key prefix for isolation:

| Role | Key Prefix | TTL | Description |
|---|---|---|---|
| **PDP cache** | `pdp:{userId}:{resource}` | 30 s | Cached authorization decisions from the Policy Decision Point; invalidated on policy change via pub/sub |
| **Session data** | `sess:{sessionId}` | 8 h | Refresh token metadata, session fingerprint, device info |
| **Hot counters** | `cnt:{type}:{id}` | 60 s | Active incident counts, unread notifications; periodically flushed to PostgreSQL |
| **Pub/Sub** | `chan:*` | N/A | Session revocation broadcast (revoke one user across all nodes), realtime event fan-out across gateway replicas |
| **Presence** | `pres:{userId}` | 90 s | User online status; heartbeat every 30s renews TTL; expiry = offline |
| **Sorted sets** | `unread:{userId}`, `seq:{channelId}` | Persistent | Unread notification counts, per-channel message sequence numbers |
| **Rate limiting** | `rl:{surface}:{key}` | Window-dependent | Token bucket state for API rate limiting |

**Eviction policy:** `allkeys-lfu` for cache databases; `noeviction` for session and rate-limit databases.

**High availability:** Redis Sentinel with 3 nodes (1 primary, 2 replicas). Automatic failover within 30 seconds.

### 6.4 MinIO Strategy

MinIO provides S3-compatible object storage, deployable on-premise with no public cloud dependency:

**Bucket structure:**
```
sentinel-{tenant_id}-files/        # User-uploaded files
sentinel-{tenant_id}-documents/    # Generated documents (PDFs, reports)
sentinel-{tenant_id}-media/        # Voice/video recordings
sentinel-audit/                    # Cross-tenant audit artifacts (WORM)
sentinel-backups/                  # Database backup snapshots
sentinel-temp/                     # Temporary processing (24h lifecycle)
```

**Content addressing:** Files are stored by `{SHA-256-prefix}/{SHA-256}/{uuid}.{ext}`. Deduplication is achieved by checking SHA-256 before upload; if the hash exists, a new metadata record points to the existing object.

**Object lock (WORM):** The `sentinel-audit` bucket uses S3 Object Lock in COMPLIANCE mode. Once written, audit artifacts cannot be deleted or overwritten until the retention period (7 years) expires. This satisfies regulatory requirements for immutable audit trails.

**Lifecycle policies:**
- Incomplete multipart uploads: automatically cleaned after 24 hours
- Temporary processing bucket: all objects expire after 24 hours
- Cold storage tiering: files not accessed for 90 days are moved to erasure-coded cold tier

**Encryption:** Server-Side Encryption with S3-managed keys (SSE-S3). Encryption keys are managed by MinIO KMS, backed by HashiCorp Vault.

**Virus scanning:** Every uploaded file is scanned by ClamAV before being made available. Files are uploaded to a quarantine prefix, scanned by a worker, and moved to the final prefix only on clean scan result. Infected files are logged, quarantined, and the uploader is notified.

### 6.5 OpenSearch Strategy

OpenSearch provides full-text search and log aggregation:

**Indexes:**

| Index | Source | Refresh | Purpose |
|---|---|---|---|
| `incidents` | Projected from `incident.created/updated` events | 1 s | Full-text search across incident titles, descriptions, notes, ICS assignments |
| `messages` | Projected from `chat.message.sent` events | 5 s | Full-text search across chat messages |
| `documents` | Projected from `document.indexed` events | 5 s | Full-text search across document content (extracted text) |
| `audit-*` | Shipped from structured logs via Vector | 30 s | Log aggregation, security event correlation, compliance queries |

**Index design:**
- Per-tenant filtering via `tenant_id` field (not separate indexes per tenant -- simpler operations)
- Sharding: 3 primary shards per index, 1 replica
- ILM (Index Lifecycle Management): hot (7 days) -> warm (30 days) -> cold (1 year) -> delete (per retention policy)

**Graceful degradation:** If OpenSearch becomes unavailable:
1. Search requests fall back to PostgreSQL `pg_trgm` with `similarity()` and `word_similarity()` functions
2. A degradation banner is displayed in the UI: "Search results may be limited"
3. New events accumulate in NATS (durable stream) and are replayed to OpenSearch upon recovery
4. Alerting fires after 60 seconds of unavailability

```typescript
async searchIncidents(query: string, tenantId: string): Promise<SearchResult[]> {
  try {
    return await this.openSearch.search('incidents', query, { tenantId });
  } catch (error) {
    if (error instanceof OpenSearchUnavailableError) {
      this.metrics.increment('search.fallback.pg_trgm');
      return await this.pgFallback.searchIncidents(query, tenantId);
    }
    throw error;
  }
}
```

---

## 7. Security Architecture

### 7.1 Authentication Flow

**Standard login flow:**
```
Client                     BFF                    API Gateway           IAM Module
  |                         |                         |                     |
  |-- POST /auth/login ---->|                         |                     |
  |   {email, password}     |-- POST /api/v1/auth --->|                     |
  |                         |   + mTLS                |-- validateCreds --->|
  |                         |                         |                     |
  |                         |                         |<-- MFA required ----|
  |                         |<-- 202 mfa_challenge ---|                     |
  |<-- 202 + challenge_id --|                         |                     |
  |                         |                         |                     |
  |-- POST /auth/mfa ------>|                         |                     |
  |   {challenge_id, code}  |-- POST /api/v1/mfa ---->|                     |
  |                         |                         |-- verifyMFA ------->|
  |                         |                         |                     |
  |                         |                         |<-- tokens ----------|
  |                         |<-- Set-Cookie -----------|                     |
  |<-- 200 + cookies -------|   access_token (10min)  |                     |
  |   (HTTP-only, Secure,   |   refresh_token (8h)    |                     |
  |    SameSite=Strict)     |                         |                     |
```

**Token lifecycle:**
- **Access token:** JWT, 10-minute expiry, contains `userId`, `tenantId`, `roles[]`, `clearanceLevel`, `iat`, `exp`. Signed with RS256 (asymmetric -- API Gateway verifies with public key, only IAM holds private key).
- **Refresh token:** Opaque random string, 8-hour expiry, stored in Redis with metadata (user agent, IP, session fingerprint). Bound to a single session.
- **Refresh rotation with reuse detection:** Each refresh operation issues a new refresh token and invalidates the old one. If a previously-used refresh token is presented (indicating token theft), all sessions for that user are revoked and the user is notified.

**SSO integration:**
- OpenID Connect with Keycloak (primary) or Azure AD (ministry integration)
- Authorization Code Flow with PKCE
- Claims mapping: `sub` -> `externalId`, `groups` -> `roles`, `clearance` -> `clearanceLevel`
- JIT provisioning: first SSO login creates the user record with mapped roles

**WebAuthn:**
- Required for `platform_admin` and `security_admin` roles
- Supported for all users as optional strong factor
- Break-glass: WebAuthn + time-limited override code from security officer

### 7.2 Authorization Model

Authorization uses a hybrid RBAC + ABAC model:

**RBAC layer (coarse-grained):**

| Role | Scope | Description |
|---|---|---|
| `platform_admin` | Global | Full system access, bypasses RLS, manages tenants |
| `security_admin` | Tenant | Manages IAM policies, roles, audit review |
| `operations_chief` | Tenant | Manages all incidents, full read/write |
| `incident_commander` | Incident | Full control of assigned incident |
| `section_chief` | Incident | Manages assigned ICS section |
| `field_responder` | Incident | Executes tasks, reports status |
| `dispatcher` | Tenant | Resource allocation, unit dispatch |
| `analyst` | Tenant | Read-only analytics, report generation |
| `observer` | Incident | Read-only incident view (liaison, media) |
| `system_service` | Internal | Service-to-service authentication |

**ABAC layer (fine-grained, context-sensitive):**

Attributes evaluated at decision time:
- `user.clearanceLevel` -- must meet or exceed `resource.classificationLevel`
- `user.tenantId` -- must match `resource.tenantId` (enforced via RLS as defense-in-depth)
- `incident.commander` -- incident-scoped admin rights
- `incident.severity` -- CRITICAL incidents may unlock elevated rate limits and break-glass procedures
- `resource.owner` -- users may modify their own resources even without broad write permissions
- `time.isBusinessHours` -- some operations restricted outside business hours for non-emergency roles

**Policy Decision Point (PDP):**

The IAM module exposes a PDP that evaluates authorization requests:

```typescript
interface AuthzRequest {
  subject: { userId: string; roles: string[]; clearance: number; tenantId: string };
  action: string;       // e.g., 'incident:update', 'task:assign', 'document:read'
  resource: { type: string; id: string; classification: number; tenantId: string };
  context: { incidentId?: string; severity?: string };
}

interface AuthzResponse {
  allowed: boolean;
  reason?: string;      // For audit logging
  obligations?: string[]; // e.g., 'must_log', 'must_encrypt'
}
```

**Evaluation order:**
1. Explicit deny rules -> DENY (deny always wins)
2. Explicit allow rules -> ALLOW
3. No matching rule -> DENY (default deny)

**PDP cache:** Authorization decisions are cached in Redis with a 30-second TTL, keyed by `pdp:{userId}:{action}:{resourceType}`. Cache is invalidated immediately on policy change via Redis pub/sub broadcast to all nodes.

### 7.3 Encryption

**In transit:**
- External: TLS 1.3 mandatory, HSTS with `max-age=31536000; includeSubDomains; preload`
- Internal: mTLS between all services, certificates managed by cert-manager with short-lived (24h) rotation
- Cipher suites: TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256 (TLS 1.3 only)

**At rest:**
- PostgreSQL: full-disk encryption via LUKS (dm-crypt), optional Transparent Data Encryption (pg_tde) for column-level
- MinIO: SSE-S3 with keys managed by MinIO KMS backed by HashiCorp Vault
- Redis: encrypted RDB/AOF persistence via LUKS-encrypted volumes
- Backups: AES-256-GCM encrypted before transfer to off-site storage

**Key management:**
- HashiCorp Vault (or HSM in SECRET-classified deployments)
- Auto-unseal via Shamir shares or cloud KMS (for non-air-gapped)
- Key rotation: encryption keys rotated quarterly; old keys retained for decryption only
- Transit secrets engine for application-level envelope encryption

**Field-level encryption:**
- PII fields (phone numbers, national IDs, medical notes) optionally encrypted per tenant policy
- Envelope encryption: data key encrypted by master key in Vault
- Searchable encryption not supported; encrypted fields are excluded from search indexes

### 7.4 Rate Limiting

Rate limits are enforced at the API Gateway using a Redis-backed token bucket algorithm:

| Surface | Limit | Burst | Key |
|---|---|---|---|
| `POST /auth/login` | 5/min | 10 | IP address |
| `POST /auth/mfa` | 5/min | 10 | IP address + challenge_id |
| Authenticated read endpoints | 600/min | 1,200 | User ID |
| Authenticated write endpoints | 120/min | 240 | User ID |
| File upload | 30/min | 60 | User ID |
| WebSocket subscribe | 200/min | 400 | Socket ID |
| WebSocket publish (chat message) | 60/min | 120 | User ID |

**Dynamic escalation:** During incidents with severity CRITICAL, rate limits for `incident_commander` and `field_responder` roles are automatically doubled. This is evaluated at the PDP level and applied via a rate-limit-tier header.

**Response on limit exceeded:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "status": 429,
    "details": [
      { "retryAfter": 12, "limit": 120, "remaining": 0, "resetAt": "2026-04-12T10:00:12Z" }
    ],
    "traceId": "0af7651916cd43dd8448eb211c80319c"
  }
}
```

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

### 7.5 STRIDE Threat Model

| Threat | Category | Attack Vector | Mitigation |
|---|---|---|---|
| **Spoofing** | Identity | Stolen credentials, session hijack, forged JWT | MFA for privileged users; refresh token rotation with reuse detection; JWT signed with RS256 (asymmetric); HTTP-only SameSite=Strict cookies; session fingerprinting (user-agent + IP range) |
| **Tampering** | Data Integrity | Modified request payloads, tampered audit logs, altered map data | Input validation (Zod schemas on every endpoint); WORM storage for audit (MinIO Object Lock); database checksums on critical tables; signed event payloads in NATS; HMAC on webhook deliveries |
| **Repudiation** | Accountability | User denies performing action, admin denies accessing tenant data | Immutable audit log (append-only, WORM-backed); every state change recorded with userId, timestamp, IP, user-agent; platform_admin actions double-logged with justification field; audit retention 7 years |
| **Information Disclosure** | Confidentiality | SQL injection, log leakage, unauthorized data access, API over-exposure | Parameterized queries (never string interpolation); RLS as defense-in-depth; no PII in logs; classification-based ABAC; field-level encryption for PII; response filtering by clearance level; error messages never expose internals |
| **Denial of Service** | Availability | Request flooding, resource exhaustion, slowloris, WebSocket abuse | Multi-layer rate limiting (edge WAF + application); connection limits per IP; request body size limits (10 MB default, 500 MB file upload); WebSocket frame size limits; bulkhead pools; circuit breakers on dependencies; auto-scaling in Kubernetes |
| **Elevation of Privilege** | Authorization | Role manipulation, tenant escape, IDOR, path traversal | RBAC + ABAC at PDP; RLS at database; tenant_id on every query; authorization checked at controller AND service layer; no sequential IDs (UUIDv7); path traversal protection on file operations; container runs as non-root with read-only filesystem |

**Security testing cadence:**
- SAST: every PR (CodeQL, Semgrep)
- DAST: weekly (OWASP ZAP)
- Dependency scanning: daily (Trivy, npm audit)
- Penetration test: annually (external firm)
- Red team exercise: annually (includes social engineering)

---

## 8. Resilience Patterns

### 8.1 Retries

**HTTP calls (internal service-to-service):**
- Strategy: exponential backoff with full jitter
- Base delay: 50 ms
- Max delay: 1,600 ms
- Max attempts: 5
- Jitter: `random(0, min(cap, base * 2^attempt))`
- Retryable: 502, 503, 504, connection reset, timeout
- Non-retryable: 400, 401, 403, 404, 409, 422

**Idempotent writes:**
- All write endpoints accept an `Idempotency-Key` header (UUID)
- Server stores `{key, status, response}` in Redis with 24h TTL
- Duplicate requests return the stored response without re-executing
- Critical for network retries and at-least-once delivery from NATS consumers

**NATS consumers:**
- `MaxDeliver`: 8 attempts
- Backoff: exponential (1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s)
- After MaxDeliver exhausted: message moved to Dead Letter Queue (DLQ) stream
- DLQ monitored via alert: `events_dlq_depth > 0` triggers PagerDuty

### 8.2 Circuit Breakers

Implemented via `opossum` (Node.js circuit breaker library):

```typescript
const breaker = new CircuitBreaker(callExternalService, {
  timeout: 3000,           // 3s timeout per call
  errorThresholdPercentage: 50, // Open after 50% failure rate
  resetTimeout: 30000,     // Try half-open after 30s
  rollingCountTimeout: 60000, // 60s rolling window
  rollingCountBuckets: 6,  // 10s per bucket
  volumeThreshold: 20,     // Minimum 20 requests before evaluating
});

breaker.fallback(() => {
  throw new DependencyUnavailableError('external-service');
});

breaker.on('open', () => metrics.increment('circuit.open', { service: 'external-service' }));
```

**Circuit breaker per dependency:**
| Dependency | Timeout | Threshold | Reset |
|---|---|---|---|
| OpenSearch | 2 s | 50% / 20 req | 30 s |
| MinIO | 5 s | 50% / 10 req | 60 s |
| External APIs (seismic, weather) | 10 s | 30% / 5 req | 120 s |
| SMS gateway | 5 s | 40% / 10 req | 60 s |

When a circuit is open, the application returns a `DependencyUnavailableError` which the BFF translates to a degraded UI state with a user-visible banner.

### 8.3 Bulkheads

Resource isolation prevents cascade failures:

**Process-level:**
- API Gateway, Workers, Realtime Gateway, and SFU run as separate Kubernetes Deployments with independent resource limits
- Workers cannot starve API Gateway of CPU/memory

**Connection-level:**
- Per-module database connection pools (see section 6.2)
- Separate Redis connections for cache vs. pub/sub vs. rate limiting
- NATS subscriptions per module with independent flow control

**Thread-level (Node.js):**
- CPU-intensive operations (PDF generation, image processing) run in worker threads or are offloaded to dedicated worker pods
- The API event loop is never blocked by compute-heavy operations

### 8.4 Graceful Degradation Matrix

| Failure Scenario | Detection | Behavior | User Experience |
|---|---|---|---|
| **OpenSearch down** | Health check fails, circuit opens | Full-text search falls back to `pg_trgm` | Banner: "Search results may be limited"; basic search works; advanced facets disabled |
| **NATS down** | Connection lost, health check fails | Outbox pattern accumulates events in PostgreSQL; events are flushed to NATS on reconnection | Banner: "Live sync paused -- data is being saved"; UI works normally for direct reads/writes |
| **MinIO down** | Upload fails, circuit opens | Uploads queued client-side with exponential retry; existing files served from CDN cache if available | Banner: "File uploads temporarily unavailable"; retry button shown; existing files still viewable |
| **Realtime Gateway down** | WebSocket disconnect detected | Client auto-reconnects with exponential backoff; falls back to 5-second polling via REST | Banner: "Live updates paused -- refreshing periodically"; data remains accessible |
| **Redis down** | Connection error, circuit opens | PDP decisions computed without cache (higher latency); sessions fall back to JWT-only validation; rate limiting falls back to in-memory approximate counters | No visible banner; slightly higher latency; rate limits less precise |
| **Database replica down** | Health check fails | Analytics queries route to remaining replicas; if all replicas down, route to primary with lower priority | No visible banner for light load; "Analytics temporarily slower" during heavy periods |
| **Primary database down** | Replication lag spike, health check | Promote standby to primary (automated via Patroni); max 60 seconds of unavailability | Brief service interruption; automatic recovery; no data loss within RPO |
| **External API down** | Circuit breaker opens | Stale data served from cache; degraded feature shown | "Weather data last updated 15 min ago"; "Seismic feed unavailable" |

### 8.5 Disaster Recovery

**Backup strategy:**
| Component | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | WAL streaming to standby + pg_basebackup | Continuous WAL + 6-hourly base | 30 days local, 90 days off-site |
| Redis | RDB snapshots + AOF | Every 5 min (RDB) + continuous (AOF) | 7 days |
| MinIO | Bucket replication to DR site | Continuous (async) | Same as source |
| OpenSearch | Snapshot to MinIO | Daily | 30 days |
| NATS | Stream replication | Continuous (R3 -- 3 replicas) | Per-stream retention policy |

**DR topology:**
- **Primary site:** Full deployment with 3-node PostgreSQL (Patroni), 3-node Redis Sentinel, 4-node MinIO, 3-node NATS cluster
- **DR site:** Warm standby with streaming replica (PostgreSQL), Redis replica, MinIO mirror, NATS mirror
- **Async replication lag:** typically < 1 second, worst case < 60 seconds (RPO guarantee)

**Failover procedure:**
1. Automated detection: Patroni detects primary failure, promotes standby (< 30s)
2. DNS update: weighted DNS shifts traffic to DR site (< 5 min with low TTL)
3. Application reconnection: services reconnect to new primary automatically
4. Verification: automated smoke tests confirm data integrity
5. Total RTO: < 15 minutes

**DR drills:** Conducted quarterly. Each drill simulates a different failure scenario (database failure, full site failure, network partition). Results are documented and improvement items tracked.

---

## 9. Observability

### 9.1 Logging

**Format:** Structured JSON via `pino` (high-performance Node.js logger):

```json
{
  "ts": "2026-04-12T08:15:32.123Z",
  "level": "info",
  "msg": "Incident created",
  "requestId": "req_01HXYZ...",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "spanId": "00f067aa0ba902b7",
  "tenantId": "t_01HXYZ...",
  "userId": "u_01HXYZ...",
  "route": "POST /api/v1/incidents",
  "statusCode": 201,
  "latencyMs": 47,
  "incidentId": "inc_01HXYZ...",
  "severity": "HIGH"
}
```

**Rules:**
- No PII in logs (no names, emails, phone numbers, national IDs, passwords, tokens)
- Request/response bodies logged only at DEBUG level and only in non-production environments
- All log entries include `requestId` and `traceId` for correlation
- Log levels: `fatal`, `error`, `warn`, `info`, `debug`, `trace`
- Production default: `info`
- Per-module log level override via environment variable

**Shipping pipeline:**
```
Application (pino) --> stdout --> Vector (sidecar) --> OpenSearch
                                                  --> S3 (long-term archive)
```

**Retention:**
| Tier | Duration | Storage |
|---|---|---|
| Hot | 30 days | OpenSearch SSD |
| Warm | 1 year | OpenSearch HDD |
| Cold (audit-related) | 7 years | MinIO (WORM) |
| Cold (non-audit) | 1 year | MinIO |

### 9.2 Metrics

**Collection:** Prometheus scrapes `/metrics` endpoint from every service (exposed via `prom-client`).

**Four golden signals per service:**
| Signal | Metric | Alert Threshold |
|---|---|---|
| Latency | `http_request_duration_seconds` (histogram) | p95 > 500 ms for 5 min |
| Traffic | `http_requests_total` (counter) | N/A (capacity planning) |
| Errors | `http_requests_total{status=~"5.."}` (counter) | Error rate > 1% for 5 min |
| Saturation | `nodejs_active_handles_total`, connection pool utilization | > 80% for 10 min |

**Domain-specific metrics:**
| Metric | Type | Description |
|---|---|---|
| `sentinel_incidents_open` | Gauge | Currently open incidents by severity |
| `sentinel_tasks_overdue` | Gauge | Tasks past SLA deadline |
| `sentinel_events_dlq_depth` | Gauge | Dead letter queue depth (> 0 = alert) |
| `sentinel_ws_connections` | Gauge | Active WebSocket connections |
| `sentinel_mediasoup_active_calls` | Gauge | Active voice/video sessions |
| `sentinel_nats_pending_messages` | Gauge | Pending messages per consumer |
| `sentinel_db_pool_utilization` | Gauge | Connection pool usage percentage |
| `sentinel_auth_failures` | Counter | Authentication failures by reason |
| `sentinel_search_fallback_total` | Counter | OpenSearch fallback to pg_trgm |

**Dashboards (Grafana):**
- Platform Overview: golden signals, incident counts, WS connections, NATS health
- Per-Module Detail: latency histograms, error rates, dependency health
- Infrastructure: CPU, memory, disk, network per pod
- Security: auth failures, rate limit hits, circuit breaker states
- Incident Operations: real-time incident KPIs for operations chiefs

**Alerting (Alertmanager):**
- Critical alerts (p95 latency > 1s, error rate > 5%, DLQ depth > 0, database failover) route to PagerDuty/OpsGenie
- Warning alerts (p95 latency > 500ms, error rate > 1%, pool saturation > 80%) route to Slack
- Info alerts (deployment events, scaling events) route to dashboard

### 9.3 Tracing

**Implementation:** OpenTelemetry SDK with auto-instrumentation:

```typescript
// tracing.ts -- loaded before application bootstrap
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION,
  }),
});
sdk.start();
```

**Auto-instrumented spans:**
- HTTP requests (inbound and outbound)
- PostgreSQL queries (with sanitized SQL)
- Redis commands
- NATS publish/subscribe
- S3/MinIO operations

**Context propagation:**
- HTTP: `traceparent` header (W3C Trace Context)
- NATS: `traceparent` in event envelope metadata
- WebSocket: `traceparent` in connection handshake, propagated to downstream calls

**Sampling strategy:**
| Condition | Sample Rate | Rationale |
|---|---|---|
| Error responses (4xx, 5xx) | 100% | Every error is debuggable |
| Incident severity HIGH or CRITICAL | 100% | Full observability during emergencies |
| Normal requests | 10% | Sufficient for performance baselines |
| Health checks | 0% | Noise reduction |

**Backend:** Traces exported via OTLP to Grafana Tempo (or Jaeger). Linked to logs via `traceId` for seamless drill-down.

### 9.4 Health Probes

Every service exposes two endpoints:

**`/healthz` (liveness probe):**
- Returns 200 if the process is alive and the event loop is not blocked
- Does not check dependencies (a slow database should not cause restarts)
- Kubernetes uses this to detect deadlocked processes

**`/readyz` (readiness probe):**
- Returns 200 only when the service can serve traffic
- Checks: database connection, Redis connection, NATS connection (as applicable per service)
- Returns 503 with details of which dependency is unavailable
- Kubernetes removes the pod from the Service endpoint until ready

```json
// GET /readyz response when degraded
{
  "status": "degraded",
  "checks": {
    "postgresql": { "status": "up", "latency_ms": 2 },
    "redis": { "status": "up", "latency_ms": 1 },
    "nats": { "status": "down", "error": "connection refused" },
    "opensearch": { "status": "up", "latency_ms": 15 }
  }
}
```

**Internal status page:** Accessible to operations team at `/internal/status`, aggregating health of all services and dependencies with 30-second refresh.

### 9.5 Frontend Observability

**Web Vitals monitoring:**
- LCP, FID, CLS, TTFB, INP measured per route
- Reported to backend analytics endpoint
- Dashboards track regression per release

**Error tracking:**
- GlitchTip (Sentry-compatible, self-hosted -- no external data dependency)
- Source maps uploaded at build time
- Errors grouped by route, browser, user role
- Alerting on new error types or error rate spikes

**Session replay:**
- Disabled by default (privacy concern for government platform)
- Can be enabled per-session with explicit user consent for debugging
- Recordings stored in MinIO with 7-day auto-expiry

**Client-side performance budget:**
| Metric | Budget | Enforcement |
|---|---|---|
| JavaScript bundle (per route) | < 200 KB (gzipped) | CI fails if exceeded |
| LCP | < 2.5 s | Dashboard alert |
| CLS | < 0.1 | Dashboard alert |
| INP | < 200 ms | Dashboard alert |

---

## 10. Cross-Cutting Concerns

### 10.1 ID Strategy

**UUIDv7** is used for all primary keys across all tables and all services.

Rationale:
- **Time-ordered:** The embedded timestamp ensures B-tree index inserts are always append-only, eliminating page splits and maintaining index locality. This is critical for tables with billions of rows (audit events).
- **Globally unique:** No coordination needed between services, databases, or shards. Safe for future extraction to microservices.
- **Non-enumerable:** Unlike sequential integers, UUIDs cannot be guessed or iterated by attackers (no IDOR via ID increment).

Implementation:
- PostgreSQL: `uuidv7()` PL/pgSQL function (see section 6.1) as `DEFAULT` for all `id` columns
- Application: `uuidv7` npm package for generating IDs in application code when needed before insert
- Migration path: when PostgreSQL 18 ships native `uuidv7()`, replace the polyfill

**URL safety:** IDs appear in URLs (e.g., `/incidents/01901e64-6c60-7d20-8a4e-b6c1d3a2f0e1`) but every endpoint validates that the authenticated user has access to the referenced resource. Knowing an ID alone grants no access.

### 10.2 Pagination

All list endpoints use **cursor-based pagination** exclusively. Offset-based pagination is not supported.

Rationale:
- Stable under concurrent inserts (no skipped or duplicated rows)
- O(1) seek time regardless of page depth (vs. O(n) for OFFSET)
- Natural fit for infinite scroll and "load more" patterns in the UI

**Cursor format:** Base64-encoded JSON of `(sort_key_value, id)`. The cursor is opaque to the client.

```typescript
// Cursor encoding
const cursor = Buffer.from(JSON.stringify({
  s: row.created_at.toISOString(), // sort key value
  i: row.id,                        // tiebreaker
})).toString('base64url');

// Cursor decoding + query
const { s, i } = JSON.parse(Buffer.from(cursor, 'base64url').toString());
const rows = await db.query(`
  SELECT * FROM inc_incidents
  WHERE tenant_id = $1
    AND (created_at, id) < ($2, $3)
  ORDER BY created_at DESC, id DESC
  LIMIT $4
`, [tenantId, s, i, limit + 1]); // +1 to detect hasMore
```

**Response envelope:**
```json
{
  "data": [ ... ],
  "page": {
    "nextCursor": "eyJzIjoiMjAyNi0wNC0xMlQwODowMDowMFoiLCJpIjoiMDE5MDFlNjQtNmM2MC03ZDIwLThhNGUtYjZjMWQzYTJmMGUxIn0",
    "prevCursor": "eyJzIjoiMjAyNi0wNC0xMlQxMDowMDowMFoiLCJpIjoiMDE5MDFlNjQtNmM2MC03ZDIwLThhNGUtYjZjMWQzYTJmMGUyIn0",
    "limit": 20,
    "hasMore": true
  }
}
```

### 10.3 Error Model

All API errors follow a consistent format:

```json
{
  "error": {
    "code": "INCIDENT_ALREADY_CLOSED",
    "message": "Cannot update incident because it is already in CLOSED status",
    "status": 409,
    "details": [
      {
        "field": "status",
        "reason": "Incident inc_01HXYZ was closed at 2026-04-12T09:00:00Z"
      }
    ],
    "traceId": "0af7651916cd43dd8448eb211c80319c",
    "docs": "https://docs.sentinel.gov/errors/INCIDENT_ALREADY_CLOSED"
  }
}
```

**Code taxonomy:** Codes follow the pattern `DOMAIN_REASON`:
- `AUTH_INVALID_CREDENTIALS` -- bad email/password
- `AUTH_MFA_REQUIRED` -- MFA challenge not completed
- `AUTH_TOKEN_EXPIRED` -- access token expired
- `INCIDENT_NOT_FOUND` -- incident does not exist or is not accessible
- `INCIDENT_ALREADY_CLOSED` -- state transition violation
- `TASK_SLA_VIOLATED` -- task deadline passed
- `FILE_TOO_LARGE` -- upload exceeds size limit
- `FILE_INFECTED` -- virus scan failed
- `RATE_LIMIT_EXCEEDED` -- too many requests
- `DEPENDENCY_UNAVAILABLE` -- downstream service is down
- `VALIDATION_FAILED` -- request body failed schema validation

**HTTP status mapping:**
| Status | Usage |
|---|---|
| 400 | Request validation failure (malformed JSON, missing required field) |
| 401 | Authentication failure (no token, expired token, invalid token) |
| 403 | Authorization failure (valid identity, insufficient permissions) |
| 404 | Resource not found (or not accessible to current user -- no information leakage) |
| 409 | Conflict (state transition violation, optimistic lock failure) |
| 422 | Domain rule violation (valid request format, but business logic rejects it) |
| 429 | Rate limit exceeded |
| 500 | Unexpected internal error (always logged, always traced) |
| 503 | Dependency unavailable (database, external service) |

**Security rule:** Error messages never expose internal implementation details (stack traces, SQL errors, internal service names). In production, 500 errors return only the `traceId` for support correlation.

### 10.4 Multi-tenancy

Sentinel supports multiple civil protection agencies (or regional branches) in a single deployment. Tenant isolation is enforced at three layers:

**Layer 1 -- Application:**
- Every API request is associated with a `tenantId` extracted from the JWT
- Every database query includes `tenant_id` in its WHERE clause (defense-in-depth, not primary isolation mechanism)

**Layer 2 -- Database (RLS):**
- Every table has RLS enabled with a policy referencing `current_setting('app.tenant_id')`
- At the start of every transaction, the application executes `SET LOCAL app.tenant_id = '<uuid>'`
- `SET LOCAL` is scoped to the transaction and automatically reset on commit/rollback -- no connection pool pollution
- Even if application code omits a `WHERE tenant_id = ...` clause, RLS prevents cross-tenant data access

**Layer 3 -- Object Storage:**
- MinIO buckets are segmented per tenant: `sentinel-{tenant_id}-files/`
- Bucket policies enforce that IAM credentials can only access their tenant's bucket

**Platform admin operations:**
- Platform admins use a privileged database role that bypasses RLS
- Every query executed under the privileged role is logged in a separate audit stream with the admin's identity and justification
- Cross-tenant operations (tenant provisioning, global analytics, support) require `platform_admin` role
- The number of platform admins is limited and audited

### 10.5 Internationalization

**Supported languages at launch:**
- Russian (`ru`) -- primary
- Tajik (`tg`) -- official language
- English (`en`) -- international liaison, technical documentation

**Implementation:**
- UI strings managed via `next-intl` with JSON message files per locale
- Backend error messages include a `code` (machine-readable) and `message` (human-readable, localized based on `Accept-Language` header)
- Database content (incident names, task descriptions) is stored in the author's language; no automatic translation

**RTL readiness:**
- CSS logical properties used throughout (`margin-inline-start` instead of `margin-left`)
- Layout mirroring tested in CI via visual regression tests
- RTL languages (Arabic, Dari) can be added without CSS refactoring

**Date and time:**
- Stored in UTC (PostgreSQL `TIMESTAMPTZ`)
- Displayed in the user's configured timezone
- Default format: relative ("5 min ago") with absolute on hover ("2026-04-12 10:30:00 TJT")
- Duration formatting respects locale (e.g., "2 hours 15 minutes" vs "2 soat 15 daqiqa")

---

## 11. Repository Structure

```
sentinel/
├── apps/
│   ├── api/                     # NestJS modular monolith (all 10 bounded contexts)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── iam/         # Identity and access management
│   │   │   │   ├── incident/    # Incident lifecycle
│   │   │   │   ├── task/        # Task management
│   │   │   │   ├── document/    # Document management
│   │   │   │   ├── chat/        # Communication channels
│   │   │   │   ├── gis/         # Geospatial features
│   │   │   │   ├── file/        # File storage operations
│   │   │   │   ├── analytics/   # Data warehouse and ETL
│   │   │   │   ├── notification/# Multi-channel notifications
│   │   │   │   └── audit/       # Immutable audit log
│   │   │   ├── common/          # Shared guards, interceptors, filters, pipes
│   │   │   ├── config/          # Configuration validation (Zod)
│   │   │   └── main.ts          # Application bootstrap
│   │   ├── test/                # Integration and e2e tests
│   │   └── Dockerfile
│   │
│   ├── realtime/                # Realtime gateway (Socket.IO + Redis adapter)
│   │   ├── src/
│   │   │   ├── gateway.ts       # WebSocket gateway, event routing
│   │   │   ├── presence.ts      # Online/offline tracking
│   │   │   └── nats-bridge.ts   # NATS consumer -> WS fan-out
│   │   └── Dockerfile
│   │
│   ├── workers/                 # Background job processors (NestJS)
│   │   ├── src/
│   │   │   ├── etl/             # Analytics ETL pipelines
│   │   │   ├── notification/    # Notification dispatch (push, SMS, email)
│   │   │   ├── document/        # PDF generation, OCR
│   │   │   ├── file/            # Virus scanning, thumbnailing
│   │   │   └── outbox/          # Outbox poller (PostgreSQL -> NATS)
│   │   └── Dockerfile
│   │
│   ├── sfu/                     # mediasoup signaling server
│   │   ├── src/
│   │   │   ├── room.ts          # Room management, participant tracking
│   │   │   ├── mediasoup.ts     # Transport, producer, consumer lifecycle
│   │   │   └── recording.ts     # FFmpeg recording pipeline -> MinIO
│   │   └── Dockerfile
│   │
│   └── web/                     # Next.js frontend (App Router)
│       ├── app/
│       │   ├── (auth)/          # Login, MFA, password reset
│       │   ├── (dashboard)/     # Main dashboard
│       │   ├── incidents/       # Incident management pages
│       │   ├── tasks/           # Task board and detail pages
│       │   ├── map/             # Full-screen map view
│       │   ├── chat/            # Communication channels
│       │   ├── documents/       # Document library
│       │   ├── analytics/       # Dashboards and reports
│       │   ├── admin/           # Tenant and system administration
│       │   └── layout.tsx       # Root layout with providers
│       ├── components/          # Page-specific components
│       ├── hooks/               # Custom React hooks
│       ├── lib/                 # API client, auth utilities, i18n
│       ├── messages/            # i18n message files (ru, tg, en)
│       ├── public/              # Static assets, map sprites
│       └── Dockerfile
│
├── packages/
│   ├── contracts/               # Shared type definitions and schemas
│   │   ├── api/                 # OpenAPI schema (generated from NestJS decorators)
│   │   ├── events/              # NATS event type definitions (TypeScript interfaces)
│   │   └── dto/                 # Shared DTOs and Zod validation schemas
│   │
│   ├── ui/                      # Shared UI component library
│   │   ├── components/          # shadcn/ui components (customized for Sentinel)
│   │   ├── primitives/          # Radix UI primitives with Sentinel styling
│   │   └── index.ts             # Barrel exports
│   │
│   ├── design-tokens/           # Design system tokens
│   │   ├── colors.ts            # OKLCH color palette (dark-first)
│   │   ├── typography.ts        # Font scales, line heights
│   │   ├── spacing.ts           # Spacing scale
│   │   └── tailwind-preset.ts   # Tailwind CSS preset consuming tokens
│   │
│   ├── eslint-config/           # Shared ESLint configuration
│   │   ├── base.js              # TypeScript + import rules
│   │   ├── nest.js              # NestJS-specific rules
│   │   ├── next.js              # Next.js-specific rules
│   │   └── architecture.js      # Module boundary enforcement rules
│   │
│   └── tsconfig/                # Shared TypeScript configurations
│       ├── base.json            # Strict mode, path aliases
│       ├── nest.json            # NestJS-specific compiler options
│       └── next.json            # Next.js-specific compiler options
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml   # Local development stack (all services)
│   │   ├── docker-compose.test.yml # CI test environment
│   │   └── dockerfiles/         # Multi-stage Dockerfiles for each app
│   │
│   ├── k8s/
│   │   ├── helm/
│   │   │   └── sentinel/        # Helm chart for full platform deployment
│   │   │       ├── Chart.yaml
│   │   │       ├── values.yaml              # Default values
│   │   │       ├── values-staging.yaml      # Staging overrides
│   │   │       ├── values-production.yaml   # Production overrides
│   │   │       └── templates/
│   │   │           ├── api/                 # API deployment, service, HPA, PDB
│   │   │           ├── realtime/            # Realtime gateway deployment
│   │   │           ├── workers/             # Worker deployment
│   │   │           ├── sfu/                 # SFU deployment
│   │   │           ├── web/                 # Next.js deployment
│   │   │           ├── postgresql/          # StatefulSet (or external operator)
│   │   │           ├── redis/               # Sentinel deployment
│   │   │           ├── nats/                # NATS JetStream cluster
│   │   │           ├── minio/              # MinIO tenant
│   │   │           ├── opensearch/          # OpenSearch cluster
│   │   │           ├── monitoring/          # Prometheus, Grafana, Alertmanager
│   │   │           └── network-policies/    # Default-deny + allow rules
│   │   └── kustomize/          # Environment-specific overlays (alternative to Helm values)
│   │
│   └── terraform/
│       ├── modules/
│       │   ├── k8s-cluster/     # Kubernetes cluster provisioning
│       │   ├── database/        # PostgreSQL HA setup
│       │   ├── storage/         # MinIO/S3 bucket creation
│       │   └── networking/      # VPC, subnets, firewalls
│       ├── environments/
│       │   ├── staging/
│       │   └── production/
│       └── backend.tf           # State storage configuration
│
├── docs/
│   ├── architecture/            # This document and related diagrams
│   ├── adr/                     # Architecture Decision Records
│   ├── runbooks/                # Operational runbooks
│   └── api/                     # Generated API documentation
│
├── nx.json                      # Nx workspace configuration
├── pnpm-workspace.yaml          # pnpm workspace definition
├── package.json                 # Root package.json (scripts, devDependencies)
├── turbo.json                   # Turborepo configuration (build orchestration)
└── .github/
    └── workflows/
        ├── ci.yml               # Lint, test, build, boundary check
        ├── deploy-staging.yml   # Deploy to staging on merge to main
        └── deploy-production.yml # Deploy to production on tag
```

**Monorepo tooling:**
- **pnpm:** Package manager with workspace support; strict dependency hoisting; dramatically faster than npm/yarn for monorepos
- **Nx:** Project graph, affected-only builds, computation caching, module boundary enforcement
- **Turborepo:** Build pipeline orchestration (lint -> test -> build), remote caching

---

## 12. Decision Log

### ADR-001: NestJS Modular Monolith First

**Status:** Accepted
**Date:** 2025-09-15

**Context:** The team (8 engineers) needs to deliver a working disaster management platform within 12 months. The platform has 10 bounded contexts with complex domain logic. Team members have varying experience with distributed systems.

**Decision:** Build as a NestJS modular monolith with strict module boundaries. Plan for selective extraction to microservices in Phase 2 only when proven scaling or organizational constraints demand it.

**Alternatives considered:**
- **Microservices from day one:** Rejected. The team is too small to operate 10+ services. Network partitions, distributed transactions, and operational overhead would dominate development time. Premature decomposition leads to wrong service boundaries based on guesswork rather than real usage patterns.
- **Django/Rails monolith:** Rejected. Python and Ruby ecosystems lack strong typing, which is critical for a codebase with 10 bounded contexts and complex event contracts. TypeScript end-to-end (frontend + backend) reduces context switching.
- **Go microservices:** Rejected. Excellent for performance-critical services but slower iteration speed for rapid domain modeling. Consider for Phase 2 extractions where raw performance matters (realtime gateway, SFU signaling).

**Rationale:** A modular monolith gives us the deployment simplicity of a monolith with the architectural discipline of microservices. Module boundaries enforced by ESLint and Nx ensure that extraction is possible when needed. NestJS provides dependency injection, module system, and decorator-based metadata that map naturally to bounded contexts. TypeScript provides type safety across module boundaries and shared contracts with the Next.js frontend.

---

### ADR-002: NATS JetStream over Kafka

**Status:** Accepted
**Date:** 2025-09-22

**Context:** The platform needs durable event streaming for cross-module communication, worker job distribution, and realtime fan-out. Expected throughput: 20K events/sec peak.

**Decision:** Use NATS JetStream as the event streaming backbone.

**Alternatives considered:**
- **Apache Kafka:** Rejected. Kafka is the industry standard for high-throughput streaming but carries significant operational burden (ZooKeeper/KRaft, partition rebalancing, topic management). Our peak throughput (20K events/sec) is well within NATS JetStream capacity. Kafka's JVM footprint is problematic for sovereign on-prem deployments with limited resources.
- **RabbitMQ:** Rejected. Excellent for task queues but lacks JetStream's replay capability and stream semantics. Does not natively support event sourcing patterns.
- **Redis Streams:** Rejected. Adequate for simple use cases but lacks consumer group rebalancing, dead letter queues, and the operational maturity of NATS for durable streaming.

**Rationale:** NATS JetStream provides durable streams, consumer groups, dead letter queues, replay from any sequence, and at-least-once delivery -- all features we need. It runs as a single Go binary with minimal resource footprint, making it ideal for on-prem/air-gapped deployments. The NATS protocol is simpler to debug than Kafka's binary protocol. Native support for request-reply patterns is useful for RPC-style communication if ever needed. The NATS team's focus on cloud-native and edge deployments aligns with our sovereign deployment model.

---

### ADR-003: mediasoup over Janus/Jitsi

**Status:** Accepted
**Date:** 2025-10-05

**Context:** The platform requires real-time voice and video communication for incident commanders, field teams, and inter-agency coordination. Requirements: SFU architecture (not mesh), recording capability, integration with existing signaling via WebSocket.

**Decision:** Use mediasoup as the Selective Forwarding Unit (SFU) for voice and video.

**Alternatives considered:**
- **Janus Gateway:** Rejected. C-based, complex plugin architecture, harder to integrate with Node.js signaling server. Strong feature set but higher operational complexity.
- **Jitsi Meet (Oiginal):** Rejected. Full-featured video conferencing solution but opinionated about UI and deployment. We need a low-level SFU we can integrate into our existing UI and signaling, not a standalone video app.
- **LiveKit:** Considered viable. Go-based, excellent API, good scaling story. Rejected because mediasoup's Node.js integration is tighter with our NestJS stack, and LiveKit's cloud-first model conflicts with our sovereign deployment requirement.

**Rationale:** mediasoup is a Node.js library (with a C++ worker for media handling) that integrates naturally with our NestJS signaling server. It provides fine-grained control over transports, producers, and consumers -- essential for our custom UI that embeds video alongside incident maps and task boards. The C++ worker handles the CPU-intensive media forwarding while Node.js handles signaling, giving us the best of both worlds. Recording is achieved via FFmpeg consuming the RTP streams, with output stored in MinIO.

---

### ADR-004: shadcn/ui over MUI/Ant Design

**Status:** Accepted
**Date:** 2025-10-12

**Context:** The frontend needs a component library that supports a dark-themed, information-dense operational UI. Components must be fully customizable (not just themed) to meet the "glanceable in 3 seconds" requirement.

**Decision:** Use shadcn/ui (Radix UI primitives + Tailwind CSS) as the component foundation.

**Alternatives considered:**
- **Material UI (MUI):** Rejected. Material Design's aesthetic (rounded, spacious, consumer-oriented) conflicts with the dense, utilitarian design needed for operations centers. Theming MUI to look like an ops console requires fighting the framework at every turn. Runtime CSS-in-JS (Emotion) adds unnecessary bundle weight.
- **Ant Design:** Rejected. Better density than MUI, but the default aesthetic is opinionated and enterprise-consumer oriented. Customization requires Less variable overrides, which conflicts with our Tailwind-first approach. Large bundle size.
- **Headless UI + custom:** Considered viable but higher initial cost. shadcn/ui provides the same headless primitives (Radix) with sensible defaults we can customize.

**Rationale:** shadcn/ui is not a dependency -- it is copied into the project as source code. Every component is fully editable. Built on Radix UI primitives (which handle accessibility and keyboard navigation) and styled with Tailwind CSS (which we already use). The "copy and own" model means we can make any change without waiting for upstream releases or fighting component API limitations. The default styling is intentionally minimal, making it easier to build the dense, dark-themed ops UI we need than to strip consumer aesthetics from MUI/Ant.

---

### ADR-005: Cursor Pagination Only

**Status:** Accepted
**Date:** 2025-10-15

**Context:** List endpoints need pagination. The system handles high-volume tables (audit: 5B rows/year, chat: millions of messages per incident) with concurrent inserts.

**Decision:** All list endpoints use cursor-based pagination exclusively. Offset pagination is not implemented.

**Alternatives considered:**
- **Offset pagination (LIMIT/OFFSET):** Rejected. `OFFSET N` requires the database to scan and discard N rows, making deep pages O(N). Under concurrent inserts, rows can be skipped or duplicated between pages. For a table with 5B audit events, `OFFSET 1000000` is catastrophically slow.
- **Page number pagination:** Rejected. Same underlying mechanism as offset; provides false precision ("page 50,000 of 250,000") that is meaningless to users.
- **Keyset pagination with visible keys:** Rejected in favor of opaque cursors. Exposing sort keys in the URL leaks information about data distribution and creates a brittle API contract.

**Rationale:** Cursor pagination provides O(1) seek time regardless of depth (using a `WHERE (sort_key, id) > ($cursor_sort, $cursor_id)` index scan), is stable under concurrent inserts, and works naturally with infinite scroll / "load more" UX patterns. The cursor is opaque (base64-encoded), so we can change the underlying sort strategy without breaking clients. The tradeoff -- inability to "jump to page 500" -- is acceptable because our UI never needs random page access; users always paginate forward from a search or filter.

---

### ADR-006: Dark Theme as Ops Default

**Status:** Accepted
**Date:** 2025-10-18

**Context:** Sentinel is primarily used in operations centers (24/7 monitoring rooms), emergency response vehicles, and field conditions (nighttime disaster zones). Eye strain and screen glare are operational concerns.

**Decision:** Dark theme is the default. Light theme is available as a user preference.

**Alternatives considered:**
- **Light theme default:** Rejected. Operations center staff work 12-hour shifts in dimly lit rooms with multiple monitors. Light themes cause eye strain and screen glare that degrades operator performance over long shifts. Field responders using tablets at night prefer dark themes to preserve night vision.
- **System preference detection only:** Rejected as insufficient. Most government workstations have no system-level dark mode preference configured. Defaulting to system preference would result in light theme for most users, defeating the purpose.

**Rationale:** Military and emergency operations software universally defaults to dark themes for physiological reasons: reduced eye strain in low-light environments, less screen glare on shared displays in operations centers, and preservation of scotopic (night) vision for field personnel. The dark theme uses carefully calibrated contrast ratios (WCAG AAA for critical text) and severity-coded accent colors (red for critical, orange for warning, green for resolved) optimized for quick visual scanning. Light theme is maintained for accessibility (some users with visual impairments read better on light backgrounds) and for daytime administrative use.

---

### ADR-007: OKLCH for Color Tokens

**Status:** Accepted
**Date:** 2025-10-20

**Context:** The design system needs a color palette that supports dark and light themes, maintains perceptual uniformity across severity levels (CRITICAL, HIGH, MEDIUM, LOW), and is accessible.

**Decision:** Define all color tokens in the OKLCH color space.

**Alternatives considered:**
- **HSL:** Rejected. HSL is perceptually non-uniform: 50% lightness in green looks much brighter than 50% lightness in blue. This makes it impossible to create severity-coded colors with consistent visual weight across hues.
- **Hex/RGB:** Rejected. No conceptual separation of lightness, chroma, and hue. Makes systematic palette generation (e.g., "same perceived brightness, different hue") impossible without manual trial-and-error.
- **LCH (CIELab):** Considered viable but OKLCH improves on LCH's blue-purple hue shift issue and is natively supported in modern CSS.

**Rationale:** OKLCH provides perceptual uniformity: `oklch(0.7 0.15 30)` (red/critical) and `oklch(0.7 0.15 145)` (green/resolved) have the same perceived brightness despite different hues. This is essential for an ops dashboard where severity colors must be instantly distinguishable without relying on brightness differences. OKLCH is supported in CSS via `oklch()` function (baseline since 2023), Tailwind CSS v4 supports OKLCH natively, and it enables programmatic palette generation for P3 wide-gamut displays. Token definition:

```typescript
// design-tokens/colors.ts
export const severity = {
  critical: 'oklch(0.65 0.25 25)',   // Vivid red
  high:     'oklch(0.70 0.20 55)',   // Orange
  medium:   'oklch(0.78 0.15 85)',   // Yellow
  low:      'oklch(0.75 0.12 220)',  // Blue
  resolved: 'oklch(0.72 0.17 150)',  // Green
};
```

---

### ADR-008: Outbox Pattern, No Dual Writes

**Status:** Accepted
**Date:** 2025-10-25

**Context:** When a REST handler creates an incident, it must both write to PostgreSQL and publish an event to NATS. If the database write succeeds but the NATS publish fails (or vice versa), the system is inconsistent.

**Decision:** Use the transactional outbox pattern. Events are written to an `outbox` table in the same database transaction as the domain write. A dedicated poller reads the outbox and publishes to NATS.

**Alternatives considered:**
- **Publish after commit (fire-and-forget):** Rejected. If NATS is temporarily unavailable, events are lost. If the application crashes between commit and publish, events are lost. Unacceptable for audit events and cross-module side effects.
- **Distributed transaction (2PC):** Rejected. PostgreSQL and NATS do not share a transaction coordinator. Two-phase commit across heterogeneous systems is complex, slow, and fragile.
- **CDC (Change Data Capture) via Debezium:** Considered viable for Phase 2 but introduces a JVM dependency (Debezium + Kafka Connect) that conflicts with our minimal-dependency, air-gap-friendly deployment model. May revisit when/if we adopt Kafka.

**Rationale:** The outbox pattern guarantees that every domain write is accompanied by an event, using the same database transaction for atomicity. The outbox poller runs as a worker that polls the `outbox` table every 100ms, publishes to NATS, and marks rows as published. If NATS is unavailable, rows accumulate in the outbox (bounded by disk) and are flushed on recovery. This is simple, reliable, and requires no additional infrastructure.

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_unpublished ON outbox (created_at)
  WHERE published_at IS NULL;
```

---

### ADR-009: Row-Level Security for Tenant Isolation

**Status:** Accepted
**Date:** 2025-11-01

**Context:** The platform is multi-tenant. A bug in application code that omits a `WHERE tenant_id = ...` clause must not result in cross-tenant data leakage. This is a national security concern.

**Decision:** Enforce tenant isolation at the database level using PostgreSQL Row-Level Security (RLS).

**Alternatives considered:**
- **Application-level filtering only:** Rejected. A single missed `WHERE` clause exposes all tenants' data. Code review is necessary but insufficient for a security boundary. Defense-in-depth requires database-level enforcement.
- **Separate database per tenant:** Rejected. Operational overhead scales linearly with tenant count. Connection pool fragmentation. Schema migrations must be applied N times. Viable for very large tenants but not for our model (10-50 tenants).
- **Separate schema per tenant:** Rejected. Same migration overhead as separate databases. No improvement over RLS for our scale.

**Rationale:** RLS provides defense-in-depth: even if application code fails to filter by `tenant_id`, the database rejects the query. `SET LOCAL app.tenant_id` scoped to the transaction ensures no connection pool pollution. The performance overhead of RLS is minimal (additional predicate in query plan) and is offset by the security guarantee. Platform admins bypass RLS via a privileged role for cross-tenant operations, with every such query logged to a separate audit stream. This model supports 10-50 tenants efficiently and scales to hundreds with connection pooling via pgBouncer.

---

### ADR-010: OpenTelemetry, Vendor-Neutral Observability

**Status:** Accepted
**Date:** 2025-11-10

**Context:** The platform must be deployable in sovereign/air-gapped environments where commercial observability vendors (Datadog, New Relic, Splunk Cloud) are not available. Observability must work with self-hosted backends.

**Decision:** Use OpenTelemetry as the sole instrumentation standard. All telemetry (traces, metrics, logs) is collected via OpenTelemetry SDKs and exported via OTLP.

**Alternatives considered:**
- **Datadog APM:** Rejected. SaaS-only (Datadog agent phones home), incompatible with air-gapped deployment. Vendor lock-in on proprietary agent and query language.
- **Jaeger + Prometheus (direct instrumentation):** Rejected. Instrumenting for specific backends (Jaeger client, Prometheus client) creates vendor coupling. Switching backends requires re-instrumentation. OpenTelemetry SDKs export to any OTLP-compatible backend.
- **Elastic APM:** Rejected. Elastic's observability stack is powerful but heavy (Elasticsearch cluster for APM). We already run OpenSearch for search; adding a separate Elasticsearch cluster for APM is operationally wasteful.

**Rationale:** OpenTelemetry is the CNCF standard for observability instrumentation. It provides a single SDK that auto-instruments HTTP, database, message queue, and cache operations. Telemetry is exported via the OTLP protocol to any compatible backend: Grafana Tempo for traces, Prometheus for metrics, OpenSearch for logs. If the deployment environment changes (e.g., a ministry mandates a specific backend), we change the exporter configuration, not the instrumentation code. The OpenTelemetry Collector can run as a sidecar or daemonset, providing buffering, batching, and routing of telemetry data -- critical for air-gapped environments where data must be routed to self-hosted backends.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **BFF** | Backend-for-Frontend; a server-side layer that aggregates multiple backend calls into a single response optimized for a specific frontend |
| **Bounded Context** | A DDD concept defining a logical boundary within which a particular domain model is consistent |
| **CBRN** | Chemical, Biological, Radiological, Nuclear -- a category of hazardous incidents |
| **DLQ** | Dead Letter Queue; where messages are sent after exhausting retry attempts |
| **ICS** | Incident Command System; standardized emergency management organizational structure |
| **KChS** | Committee for Emergency Situations (Komitet po Chrezvychaynym Situatsiyam) |
| **OIDC** | OpenID Connect; identity layer on top of OAuth 2.0 |
| **PDP** | Policy Decision Point; component that evaluates authorization requests against policies |
| **RLS** | Row-Level Security; PostgreSQL feature that restricts which rows are visible per session |
| **RPO** | Recovery Point Objective; maximum acceptable data loss measured in time |
| **RTO** | Recovery Time Objective; maximum acceptable downtime after a failure |
| **SFU** | Selective Forwarding Unit; a WebRTC server that receives media streams and forwards them selectively to participants |
| **STRIDE** | Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege -- a threat modeling framework |
| **WAL** | Write-Ahead Log; PostgreSQL's mechanism for ensuring data durability and supporting replication |
| **WORM** | Write Once Read Many; storage mode where data cannot be modified or deleted after writing |

## Appendix B: Technology Version Matrix

| Technology | Version | License | Purpose |
|---|---|---|---|
| NestJS | 10.x | MIT | Backend framework |
| Next.js | 14.x (App Router) | MIT | Frontend framework + BFF |
| TypeScript | 5.x | Apache 2.0 | Language |
| PostgreSQL | 16.x | PostgreSQL License | Primary database |
| PostGIS | 3.4.x | GPL-2.0 | Spatial extensions |
| Redis | 7.x | RSALv2/SSPL | Cache, pub/sub, presence |
| MinIO | Latest | AGPL-3.0 | Object storage |
| NATS JetStream | 2.10.x | Apache 2.0 | Event streaming |
| OpenSearch | 2.x | Apache 2.0 | Full-text search, logs |
| mediasoup | 3.x | ISC | Voice/video SFU |
| Docker | 25.x | Apache 2.0 | Containerization |
| Kubernetes | 1.29.x | Apache 2.0 | Orchestration |
| Helm | 3.x | Apache 2.0 | Package management |
| OpenTelemetry | 1.x | Apache 2.0 | Observability instrumentation |
| Prometheus | 2.x | Apache 2.0 | Metrics collection |
| Grafana | 10.x | AGPL-3.0 | Dashboards |
| Vector | 0.x | MPL-2.0 | Log shipping |
| HashiCorp Vault | 1.x | BUSL-1.1 | Secrets management |
| pnpm | 9.x | MIT | Package manager |
| Nx | 19.x | MIT | Monorepo tooling |

---

*This document is maintained by the Sentinel Architecture Team. Changes require review from at least two senior engineers and approval from the Architecture Review Board.*
