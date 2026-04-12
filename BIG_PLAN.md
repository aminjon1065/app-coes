# BIG_PLAN.md
## Sentinel — National Disaster Management Platform
### Implementation-Ready Architecture, Domain & Product Specification (v1.0)

> **Audience:** Backend, Frontend, DevOps, Security, SRE, Product, Design.
> **Status:** Source-of-truth for build. Every section is binding.
> **Codename:** `sentinel`
> **Deployment posture:** Sovereign / on-prem / air-gap capable.

---

## Table of Contents

1. System Overview
2. Architecture
3. Domain-Driven Design
4. Database (Production DDL)
5. API Contracts
6. Event System
7. Realtime
8. Call System (mediasoup)
9. Document Workflow
10. Analytics
11. IAM (RBAC + ABAC)
12. Security
13. Observability
14. DevOps
15. Resilience
16. UI/UX Design
17. Implementation Roadmap

---

# 1. SYSTEM OVERVIEW

## 1.1 Mission Context

Sentinel is the operational nervous system of a national civil protection agency (KChS-class). It is used **during emergencies** — earthquakes, floods, industrial accidents, wildfires, mass casualty events, CBRN incidents, and large public gatherings. It is also used in **peacetime** for drills, planning, and post-incident analysis.

The defining constraint of Sentinel is **time-to-decision under stress**. Operators are not power users; they are humans under duress, often working 16-hour shifts, switching between phones, tablets, and 27" command-room displays. Every screen must be **glanceable in under 3 seconds** and **actionable in under 2 clicks**.

This document treats Sentinel as a *product*, not a project. The reference benchmark is not legacy government software — it is **Linear**, **Vercel**, **Notion**, **Datadog**, and **Palantir Foundry**.

## 1.2 User Roles (Personas)

| # | Persona | Role Code | Daily Context | Primary Surface |
|---|---|---|---|---|
| 1 | **Дежурный оператор (Duty Operator)** | `duty_operator` | 24/7 watch desk. Receives 112 calls, opens incidents, dispatches first response. | Dashboard + Incident Intake |
| 2 | **Старший смены (Shift Supervisor)** | `shift_lead` | Oversees 4–8 operators. Approves escalations, allocates resources. | Dashboard + Task Board |
| 3 | **Координатор инцидента (Incident Commander)** | `incident_commander` | Owns a specific incident end-to-end. Coordinates field units. | Incident Page |
| 4 | **Полевой агент (Field Responder)** | `field_responder` | Mobile, intermittent connectivity. Submits situation reports, photos, GPS. | Mobile (PWA) |
| 5 | **Аналитик ГИС (GIS Analyst)** | `gis_analyst` | Builds map layers, hazard zones, evacuation routes. | GIS Workspace |
| 6 | **Межведомственный связной (Inter-Agency Liaison)** | `agency_liaison` | Represents Police / MoH / Army inside the platform. Limited tenant scope. | Chat + Incident |
| 7 | **Аналитик/Отчётность (Analyst)** | `analyst` | Builds dashboards, post-incident reports, KPIs for ministry. | Analytics |
| 8 | **Администратор тенанта (Tenant Admin)** | `tenant_admin` | Manages users, roles, policies for a regional office. | Admin Panel |
| 9 | **Системный администратор (Platform Admin)** | `platform_admin` | Cross-tenant. Infra, integrations, audit. | Admin Panel + Observability |
| 10 | **Аудитор (Auditor)** | `auditor` | Read-only across tenants for compliance. | Audit Trail |

Each persona has a **primary screen** that must load in <1.5s and answer the question *"what do I do in the next 60 seconds?"*.

## 1.3 Operational Scenarios

### Scenario A — Earthquake (M6.2), urban area
1. Seismic feed (external sensor integration) → auto-creates `Incident` with severity `CRITICAL`.
2. Duty operators receive a **red banner** + audible alarm in <2s.
3. Shift Lead promotes one operator to Incident Commander.
4. IC opens the Incident Page; map auto-zooms to epicenter; nearest 12 field units displayed.
5. IC creates a **Task Plan** from a pre-defined template "Earthquake — Phase 1 (0–6h)".
6. Tasks auto-dispatch to field units via push.
7. Field units submit situation reports (photo + GPS + severity) → appear on map within 3s.
8. Inter-agency liaisons (Police, MoH) join the **Incident Room** chat.
9. Documents (initial report, evacuation order) generated from templates, sent through approval chain.
10. After 6h, Phase 2 template auto-suggested. After 72h, post-incident report auto-compiled from timeline.

### Scenario B — Flood, multi-region (slow-onset)
- Days 1–3: monitoring only, watershed sensors plotted on GIS.
- Day 4: threshold crossed → alert created → IC assigned.
- Resource pre-positioning tracked as Tasks with SLA timers.
- Cross-tenant collaboration (3 regional offices share one parent incident).

### Scenario C — Mass gathering (planned)
- Pre-incident "watch" object created 2 weeks ahead.
- Live monitoring with 15 field units, BodyCam streams over WebRTC.
- No real incident occurs → object closed after event with debrief notes.

### Scenario D — CBRN (worst case)
- Highest classification (`SECRET`); ABAC restricts access by clearance level.
- Break-glass access for hospital coordinator (audited, time-boxed 4h).
- Encrypted-at-rest and encrypted-in-transit with hardware-backed keys.

## 1.4 Non-Functional Targets

| Category | Metric | Target |
|---|---|---|
| **Latency** | p50 API read | < 80 ms |
| | p95 API read | < 250 ms |
| | p99 API write | < 600 ms |
| | WebSocket fan-out | < 500 ms end-to-end |
| | Map tile render | < 200 ms (cached) |
| **Throughput** | Concurrent active operators | 5,000 |
| | Concurrent WS connections | 50,000 |
| | Events per second (peak) | 20,000 |
| | Incidents (open) | 10,000 |
| **Availability** | Core (Incident, IAM, Realtime) | 99.95% |
| | Analytics | 99.5% |
| | RPO | ≤ 60 s |
| | RTO | ≤ 15 min |
| **Scale** | Documents | 100M |
| | Audit events / year | 5B |
| | Map features (live) | 1M |
| **Security** | Data classification levels | 4 (PUBLIC / INTERNAL / CONFIDENTIAL / SECRET) |
| | MFA enforcement | 100% privileged users |
| | Audit retention | 7 years |
| **Usability** | Time to open incident from cold start | < 3 s |
| | Clicks to dispatch first task | ≤ 2 |
| | Keyboard-only operability | 100% of core flows |
| | WCAG | 2.2 AA |

---

# 2. ARCHITECTURE

## 2.1 Architectural Style

**Phase 1 (Year 1):** Modular Monolith — single NestJS deployment, strict module boundaries enforced via ESLint architectural rules and Nx project graph. Internal communication via in-process EventBus; external via NATS.

**Phase 2 (Year 2+):** Selective extraction. Modules become services *only* when they have proven a scaling, deploy-cadence, or team-ownership reason. Likely first extractions: `realtime-gateway`, `mediasoup-sfu`, `analytics-etl`.

This is non-negotiable: **no premature microservices.** A monolith with clean modules ships faster, is easier to debug under fire, and is what the operator actually depends on.

## 2.2 ASCII Diagram

```
                                  ┌────────────────────────────┐
                                  │       OPERATORS / FIELD    │
                                  │   Web (Next.js)  Mobile PWA│
                                  └──────────────┬─────────────┘
                                                 │  HTTPS / WSS / WebRTC
                                                 ▼
                            ┌──────────────────────────────────────┐
                            │         EDGE  (Nginx / Envoy)        │
                            │ TLS term · WAF · rate limit · mTLS   │
                            └──────────────┬───────────────────────┘
                                           │
              ┌────────────────────────────┼─────────────────────────────┐
              │                            │                             │
              ▼                            ▼                             ▼
   ┌────────────────────┐      ┌────────────────────────┐    ┌────────────────────┐
   │   BFF (Next API)   │      │   API GATEWAY (NestJS) │    │  REALTIME GATEWAY  │
   │ SSR · auth cookies │◀────▶│ REST · OpenAPI · IAM   │    │ WS (Socket.IO)     │
   │ session refresh    │      │ rate limit · audit     │    │ Redis adapter      │
   └────────────────────┘      └───────────┬────────────┘    └─────────┬──────────┘
                                           │                            │
                                           ▼                            │
                    ┌──────────────────────────────────────┐             │
                    │   APPLICATION CORE (NestJS Modular)  │             │
                    │ ┌──────┐┌──────┐┌──────┐┌──────────┐ │             │
                    │ │ IAM  ││Incid.││ Task ││ Document │ │             │
                    │ └──────┘└──────┘└──────┘└──────────┘ │             │
                    │ ┌──────┐┌──────┐┌──────┐┌──────────┐ │             │
                    │ │ GIS  ││ File ││ Chat ││  Audit   │ │             │
                    │ └──────┘└──────┘└──────┘└──────────┘ │             │
                    │ ┌──────┐┌──────┐┌─────────────────┐  │             │
                    │ │Analy.││Notif.││ Domain EventBus │  │             │
                    │ └──────┘└──────┘└────────┬────────┘  │             │
                    └────────────────────────┬─┴───────────┘             │
                                             │                          │
                          ┌──────────────────┼────────────┬──────────────┤
                          ▼                  ▼            ▼              ▼
                  ┌──────────────┐  ┌──────────────┐ ┌─────────┐  ┌────────────┐
                  │  PostgreSQL  │  │     Redis    │ │  MinIO  │  │ OpenSearch │
                  │  + PostGIS   │  │ cache·pubsub │ │ S3 obj. │  │ logs·search│
                  │  partitions  │  │  presence    │ │         │  │            │
                  └──────────────┘  └──────────────┘ └─────────┘  └────────────┘
                          ▲                  ▲            ▲              ▲
                          │                  │            │              │
                          │             ┌────┴────────────┴──┐           │
                          │             │   NATS JetStream   │───────────┘
                          │             │  durable streams   │
                          │             │  DLQ · replay      │
                          │             └────────┬───────────┘
                          │                      │
                          │           ┌──────────┴────────────┐
                          │           ▼                       ▼
                          │  ┌──────────────────┐   ┌────────────────────┐
                          │  │  WORKERS (Nest)  │   │  mediasoup SFU     │
                          │  │ ETL · Notif      │   │  voice / video     │
                          │  │ Doc render · OCR │   │  recording         │
                          │  └──────────────────┘   └────────────────────┘
                          │
                  ┌───────┴────────────────────────────────────────────┐
                  │  EXTERNAL INTEGRATIONS                              │
                  │  Seismic feeds · 112 telephony · SMS gw · Weather   │
                  │  Ministry registries · Maps tiles · SSO (OIDC)      │
                  └─────────────────────────────────────────────────────┘
```

## 2.3 Sync vs Async — The Rule

| Operation | Style | Why |
|---|---|---|
| User reads (get incident, list tasks) | **Sync REST** | Latency-critical, must be transactional. |
| User writes that affect own UI immediately | **Sync REST** + emit event after commit | Operator needs confirmation. |
| Cross-domain side effects (notify, index, analytics) | **Async via NATS** | Decoupled, retryable. |
| Realtime fan-out (incident updates, chat) | **WebSocket** consumed from NATS | One source of truth, multiple delivery. |
| Heavy compute (PDF render, OCR, ETL) | **Async worker** | Never block request thread. |
| External integrations (SMS, weather poll) | **Async** with circuit breaker | Don't let third parties take us down. |

**Hard rule:** A REST handler may publish events but must never *await* a downstream subscriber. Eventual consistency is documented per use case.

## 2.4 BFF Layer

The Next.js App Router acts as a **thin BFF**:

- Server Components fetch from internal Gateway over HTTP/2 with mTLS.
- Session/refresh tokens kept in **HTTP-only secure cookies** (never in localStorage).
- The browser never talks to PostgreSQL or NATS directly.
- BFF aggregates 2–4 backend calls per page where it reduces waterfalls (e.g., Incident Page = incident + tasks + chat preview + map layers in one hop).

---

# 3. DOMAIN-DRIVEN DESIGN

Each bounded context owns its tables, its events, and its REST surface. Cross-context calls go through the EventBus or through a published interface — never direct DB reads across contexts.

## 3.1 IAM Domain

**Aggregates:** `User`, `Role`, `Policy`, `Tenant`, `Session`.

**Entities:** `User`, `Group`, `Role`, `Permission`, `Policy`, `ApiKey`, `Session`, `MfaFactor`.

**Value objects:** `Email`, `PhoneNumber`, `PasswordHash`, `Clearance(PUBLIC|INTERNAL|CONFIDENTIAL|SECRET)`.

**Invariants:**
- A `User` belongs to exactly one home `Tenant` but can have guest memberships in others (limited scope).
- A `User` cannot escalate their own clearance.
- Deactivating a user invalidates all their sessions within 30s.
- A `Role` named `platform_admin` can only be assigned by another `platform_admin` and requires 2-person approval.

**Domain events:**
`iam.user.created.v1`, `iam.user.deactivated.v1`, `iam.role.assigned.v1`, `iam.role.revoked.v1`, `iam.session.opened.v1`, `iam.session.closed.v1`, `iam.mfa.enrolled.v1`, `iam.policy.changed.v1`, `iam.breakglass.activated.v1`.

## 3.2 Incident Domain (CORE)

**Aggregate root:** `Incident`.

**Entities:** `Incident`, `IncidentParticipant`, `IncidentTimelineEntry`, `IncidentClassification`, `SituationReport`, `IncidentResource`.

**Value objects:** `Severity(LOW|MODERATE|HIGH|CRITICAL)`, `Status(DRAFT|OPEN|ESCALATED|CONTAINED|CLOSED|ARCHIVED)`, `Geofence` (PostGIS polygon), `IncidentCode` (e.g. `EQ-2026-04-1234`).

**Invariants:**
- An `Incident` cannot be `CLOSED` while any `Task` linked to it is in `OPEN` or `IN_PROGRESS`.
- Severity can only be raised by `incident_commander` or above; lowering requires `shift_lead`.
- Every state transition produces a `TimelineEntry` automatically.
- An `Incident` always has exactly one **primary** Incident Commander.
- Incident codes are immutable and globally unique.

**Domain events:**
`incident.created.v1`, `incident.severity_changed.v1`, `incident.commander_assigned.v1`, `incident.status_changed.v1`, `incident.geofence_updated.v1`, `incident.sitrep.submitted.v1`, `incident.closed.v1`, `incident.reopened.v1`.

## 3.3 Task Domain

**Aggregate root:** `Task`.

**Entities:** `Task`, `Subtask`, `TaskAssignment`, `TaskComment`, `TaskDependency`.

**Value objects:** `Priority`, `Status(TODO|IN_PROGRESS|BLOCKED|REVIEW|DONE|CANCELLED)`, `SLA(deadline, breachAt)`.

**Invariants:**
- A `Task` must belong to an `Incident` *or* be a standalone planning task (mutually exclusive).
- A `Task` in state `DONE` cannot be edited (only commented).
- Circular dependencies are forbidden (validated at insert).
- SLA breach raises an event but does not auto-modify the task.

**Domain events:**
`task.created.v1`, `task.assigned.v1`, `task.status_changed.v1`, `task.sla_breached.v1`, `task.completed.v1`, `task.commented.v1`.

## 3.4 Document Domain

**Aggregate root:** `Document` (with versions as entities).

**Entities:** `Document`, `DocumentVersion`, `DocumentApproval`, `DocumentSignature`.

**Value objects:** `DocClass`, `LifecycleState(DRAFT|REVIEW|APPROVED|PUBLISHED|ARCHIVED|REVOKED)`.

**Invariants:**
- A `DocumentVersion` is immutable once `APPROVED`.
- An `APPROVED` document requires N signatures defined by its template policy.
- Revoking a published document writes a tombstone version, not a deletion.

**Domain events:**
`document.created.v1`, `document.version_added.v1`, `document.review_requested.v1`, `document.approved.v1`, `document.signed.v1`, `document.published.v1`, `document.revoked.v1`.

## 3.5 Communication Domain

**Aggregate roots:** `Channel`, `CallSession`.

**Entities:** `Channel`, `ChannelMember`, `Message`, `MessageReaction`, `CallSession`, `CallParticipant`.

**Value objects:** `ChannelType(DIRECT|GROUP|INCIDENT_ROOM|BROADCAST)`, `MessageKind(TEXT|FILE|SYSTEM|SITREP|ESCALATION)`.

**Invariants:**
- An `INCIDENT_ROOM` channel is created automatically when an Incident enters `OPEN` and archived when the Incident is `ARCHIVED`.
- Members of `INCIDENT_ROOM` are derived from incident participants — no manual add.
- A message cannot be hard-deleted; only soft-redacted with audit reason.

**Domain events:**
`chat.message.posted.v1`, `chat.message.redacted.v1`, `chat.channel.created.v1`, `call.started.v1`, `call.joined.v1`, `call.left.v1`, `call.ended.v1`, `call.recording_ready.v1`.

## 3.6 GIS Domain

**Aggregate root:** `MapLayer`, `MapFeature`.

**Entities:** `MapLayer`, `MapFeature`, `LayerPermission`.

**Value objects:** `Geometry` (PostGIS), `LayerKind(BASE|HAZARD|RESOURCE|ROUTE|INCIDENT|DRAW)`, `Style`.

**Invariants:**
- A `MapFeature` always references a `tenant_id` and a `layer_id`.
- A `BASE` layer is read-only and managed by `platform_admin`.
- Coordinates always stored in EPSG:4326; reprojected on read if needed.

**Domain events:**
`gis.feature.created.v1`, `gis.feature.updated.v1`, `gis.feature.deleted.v1`, `gis.layer.published.v1`.

## 3.7 File Domain

**Aggregate root:** `File`.

**Entities:** `File`, `FileVariant` (thumbnail, OCR text), `FileScanResult`.

**Invariants:**
- Every uploaded file is **AV-scanned** before becoming reachable.
- File checksum is unique per tenant; duplicate uploads return the existing reference.
- Files are addressed by content hash + uuid; physical paths in MinIO are never exposed.

**Domain events:**
`file.uploaded.v1`, `file.scanned.v1`, `file.scan_failed.v1`, `file.variant_ready.v1`, `file.deleted.v1`.

## 3.8 Analytics Domain

Read-side context. Owns its own denormalized tables (`fact_*`, `dim_*`). Subscribes to all `*.v1` events.

**Invariants:**
- Analytics never writes back to operational tables.
- Lag between source and fact table p95 < 30s.

## 3.9 Notification Domain

**Aggregate root:** `NotificationRule`, `Notification`.

**Channels:** in-app, push (FCM/APNs), SMS, email, voice call (TTS), siren integration.

**Invariants:**
- A notification rule is **idempotent on event id** — same event never fires same rule twice.
- User notification preferences cannot suppress `SEVERITY=CRITICAL` broadcasts.

## 3.10 Audit Domain

Append-only context. Every domain emits to it. No updates, no deletes (ever).

**Invariants:**
- Every audit row has `actor_id`, `tenant_id`, `event`, `target`, `before`, `after`, `ip`, `ts`, `signature`.
- Audit storage is a separate physical schema with `REVOKE ALL` to application roles except `INSERT`.

## 3.11 Ownership Boundaries

| Context | Owns Tables (prefix) | May Read From | Communicates Via |
|---|---|---|---|
| IAM | `iam_*` | — | events, REST |
| Incident | `inc_*` | iam (read model) | events, REST |
| Task | `task_*` | iam, incident (read model) | events, REST |
| Document | `doc_*` | iam, incident (read model) | events, REST |
| Communication | `chat_*`, `call_*` | iam, incident (read model) | events, WS |
| GIS | `gis_*` | iam, incident (read model) | events, REST |
| File | `file_*` | iam | events, REST |
| Analytics | `fact_*`, `dim_*` | all (subscribe only) | events |
| Notification | `notif_*` | iam | events |
| Audit | `audit_*` | — | events (write-only) |

Cross-context joins are **forbidden in code**. Read models are projected via events.

---

# 4. DATABASE (PRODUCTION DDL)

PostgreSQL 16 + PostGIS 3.4. Multi-tenant via `tenant_id` column on every table + **Row-Level Security**. Time-series-heavy tables are partitioned monthly.

## 4.1 Conventions

- All ids are `uuid` generated with `uuidv7()` (time-ordered, index-friendly).
- Every table has `created_at`, `updated_at`, `created_by`, `updated_by`, `tenant_id`.
- Every soft-deletable table has `deleted_at` (nullable).
- All timestamps are `timestamptz`.
- Money/severity etc. are explicit enums or smallints, never strings.
- Names are `snake_case`, plural for tables.

## 4.2 Extensions & Setup

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

CREATE SCHEMA iam;
CREATE SCHEMA incident;
CREATE SCHEMA task;
CREATE SCHEMA document;
CREATE SCHEMA chat;
CREATE SCHEMA gis;
CREATE SCHEMA file;
CREATE SCHEMA analytics;
CREATE SCHEMA audit;

-- uuidv7 polyfill (until pg18)
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send((extract(epoch from clock_timestamp())*1000)::bigint) from 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  uuid_bytes = set_byte(uuid_bytes, 6, (b'01110000' | (get_byte(uuid_bytes,6) & 15)));
  uuid_bytes = set_byte(uuid_bytes, 8, (b'10000000' | (get_byte(uuid_bytes,8) & 63)));
  RETURN encode(uuid_bytes,'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;
```

## 4.3 IAM Schema

```sql
CREATE TABLE iam.tenants (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text UNIQUE NOT NULL,
  name            text NOT NULL,
  region          text,
  parent_id       uuid REFERENCES iam.tenants(id),
  status          text NOT NULL CHECK (status IN ('active','suspended','archived')),
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.users (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  email           citext UNIQUE NOT NULL,
  phone           text,
  full_name       text NOT NULL,
  password_hash   text,                    -- argon2id; null if SSO-only
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
CREATE INDEX idx_users_tenant ON iam.users(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email_trgm ON iam.users USING gin (email gin_trgm_ops);

CREATE TABLE iam.roles (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid REFERENCES iam.tenants(id),  -- null = system role
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, code)
);

CREATE TABLE iam.permissions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text UNIQUE NOT NULL,    -- e.g. 'incident.create'
  description     text
);

CREATE TABLE iam.role_permissions (
  role_id         uuid REFERENCES iam.roles(id) ON DELETE CASCADE,
  permission_id   uuid REFERENCES iam.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE iam.user_roles (
  user_id         uuid REFERENCES iam.users(id) ON DELETE CASCADE,
  role_id         uuid REFERENCES iam.roles(id) ON DELETE CASCADE,
  scope           jsonb NOT NULL DEFAULT '{}',  -- e.g. {"incident_id":"..."} for ABAC
  granted_by      uuid REFERENCES iam.users(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE iam.policies (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid REFERENCES iam.tenants(id),
  name            text NOT NULL,
  effect          text NOT NULL CHECK (effect IN ('allow','deny')),
  actions         text[] NOT NULL,
  resources       text[] NOT NULL,
  condition       jsonb NOT NULL DEFAULT '{}',  -- ABAC predicate
  priority        smallint NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.sessions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  refresh_hash    text NOT NULL,
  user_agent      text,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX idx_sessions_user_active ON iam.sessions(user_id) WHERE revoked_at IS NULL;
```

## 4.4 Incident Schema

```sql
CREATE TABLE incident.incidents (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  code            text UNIQUE NOT NULL,    -- EQ-2026-04-1234
  title           text NOT NULL,
  description     text,
  category        text NOT NULL,           -- earthquake, flood, fire, ...
  severity        smallint NOT NULL CHECK (severity BETWEEN 1 AND 4),
  status          text NOT NULL CHECK (status IN
                    ('draft','open','escalated','contained','closed','archived')),
  classification  smallint NOT NULL DEFAULT 1
                  CHECK (classification BETWEEN 1 AND 4),
  commander_id    uuid REFERENCES iam.users(id),
  geofence        geography(Polygon, 4326),
  epicenter       geography(Point, 4326),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  parent_id       uuid REFERENCES incident.incidents(id),
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_by      uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inc_tenant_status ON incident.incidents(tenant_id, status);
CREATE INDEX idx_inc_severity_open ON incident.incidents(severity DESC, opened_at DESC)
  WHERE status IN ('open','escalated');
CREATE INDEX idx_inc_geofence ON incident.incidents USING gist (geofence);
CREATE INDEX idx_inc_epicenter ON incident.incidents USING gist (epicenter);

CREATE TABLE incident.participants (
  incident_id     uuid REFERENCES incident.incidents(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES iam.users(id),
  role_in_incident text NOT NULL, -- commander, deputy, liaison, observer, responder
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (incident_id, user_id)
);

CREATE TABLE incident.timeline (
  id              uuid DEFAULT uuidv7(),
  incident_id     uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  kind            text NOT NULL, -- status_change, assignment, sitrep, doc, note
  actor_id        uuid REFERENCES iam.users(id),
  payload         jsonb NOT NULL,
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
-- monthly partitions auto-created via pg_partman
CREATE INDEX idx_timeline_incident ON incident.timeline(incident_id, ts DESC);

CREATE TABLE incident.sitreps (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  incident_id     uuid NOT NULL REFERENCES incident.incidents(id),
  tenant_id       uuid NOT NULL,
  reporter_id     uuid NOT NULL REFERENCES iam.users(id),
  location        geography(Point, 4326),
  severity        smallint,
  text            text,
  attachments     uuid[] NOT NULL DEFAULT '{}',
  reported_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sitrep_incident ON incident.sitreps(incident_id, reported_at DESC);
CREATE INDEX idx_sitrep_loc ON incident.sitreps USING gist (location);
```

## 4.5 Task Schema

```sql
CREATE TABLE task.tasks (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES iam.tenants(id),
  incident_id     uuid REFERENCES incident.incidents(id),
  title           text NOT NULL,
  description     text,
  status          text NOT NULL CHECK (status IN
                    ('todo','in_progress','blocked','review','done','cancelled')),
  priority        smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  assignee_id     uuid REFERENCES iam.users(id),
  assigner_id     uuid REFERENCES iam.users(id),
  due_at          timestamptz,
  sla_breach_at   timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  parent_task_id  uuid REFERENCES task.tasks(id),
  position        integer NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX idx_task_assignee_active ON task.tasks(assignee_id)
  WHERE status NOT IN ('done','cancelled') AND deleted_at IS NULL;
CREATE INDEX idx_task_incident_status ON task.tasks(incident_id, status);
CREATE INDEX idx_task_sla ON task.tasks(sla_breach_at)
  WHERE status NOT IN ('done','cancelled');

CREATE TABLE task.dependencies (
  task_id         uuid REFERENCES task.tasks(id) ON DELETE CASCADE,
  depends_on_id   uuid REFERENCES task.tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
```

## 4.6 Document Schema

```sql
CREATE TABLE document.documents (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  incident_id     uuid REFERENCES incident.incidents(id),
  template_code   text,
  title           text NOT NULL,
  classification  smallint NOT NULL DEFAULT 1,
  state           text NOT NULL CHECK (state IN
                    ('draft','review','approved','published','archived','revoked')),
  current_version integer NOT NULL DEFAULT 1,
  owner_id        uuid NOT NULL REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document.versions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id     uuid NOT NULL REFERENCES document.documents(id),
  version         integer NOT NULL,
  content_file_id uuid NOT NULL,            -- ref file.files
  hash_sha256     text NOT NULL,
  authored_by     uuid NOT NULL REFERENCES iam.users(id),
  authored_at     timestamptz NOT NULL DEFAULT now(),
  notes           text,
  UNIQUE (document_id, version)
);

CREATE TABLE document.approvals (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id     uuid NOT NULL REFERENCES document.documents(id),
  version         integer NOT NULL,
  approver_id     uuid NOT NULL REFERENCES iam.users(id),
  decision        text CHECK (decision IN ('pending','approved','rejected')),
  decided_at      timestamptz,
  comment         text
);
```

## 4.7 Chat & Call

```sql
CREATE TABLE chat.channels (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN
                    ('direct','group','incident_room','broadcast')),
  incident_id     uuid REFERENCES incident.incidents(id),
  name            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE TABLE chat.members (
  channel_id      uuid REFERENCES chat.channels(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES iam.users(id),
  role            text NOT NULL DEFAULT 'member',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE chat.messages (
  id              uuid DEFAULT uuidv7(),
  channel_id      uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  author_id       uuid NOT NULL REFERENCES iam.users(id),
  kind            text NOT NULL,
  body            text,
  attachments     uuid[] NOT NULL DEFAULT '{}',
  reply_to        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  redacted_at     timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_msg_channel ON chat.messages(channel_id, created_at DESC);

CREATE TABLE call.sessions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  channel_id      uuid REFERENCES chat.channels(id),
  incident_id     uuid REFERENCES incident.incidents(id),
  started_by      uuid NOT NULL REFERENCES iam.users(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  recording_file_id uuid
);
```

## 4.8 GIS Schema

```sql
CREATE TABLE gis.layers (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL,
  style           jsonb NOT NULL DEFAULT '{}',
  is_published    boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, code)
);

CREATE TABLE gis.features (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  layer_id        uuid NOT NULL REFERENCES gis.layers(id),
  incident_id     uuid REFERENCES incident.incidents(id),
  geom            geography NOT NULL,
  properties      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_feat_geom ON gis.features USING gist (geom);
CREATE INDEX idx_feat_layer ON gis.features (layer_id);
```

### Sample PostGIS query — features within an incident geofence

```sql
SELECT f.id, f.properties
FROM gis.features f
JOIN incident.incidents i ON i.id = $1
WHERE f.tenant_id = i.tenant_id
  AND ST_Intersects(f.geom, i.geofence);
```

### Sample — nearest 10 field units to an epicenter

```sql
SELECT u.id, u.full_name,
       ST_Distance(f.geom, i.epicenter) AS dist_m
FROM gis.features f
JOIN iam.users u ON u.id = (f.properties->>'user_id')::uuid
JOIN incident.incidents i ON i.id = $1
WHERE f.layer_id = (SELECT id FROM gis.layers WHERE code = 'field_units')
ORDER BY f.geom <-> i.epicenter
LIMIT 10;
```

## 4.9 File Schema

```sql
CREATE TABLE file.files (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  bucket          text NOT NULL,
  object_key      text NOT NULL,
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,
  scan_status     text NOT NULL DEFAULT 'pending'
                  CHECK (scan_status IN ('pending','clean','infected','error')),
  uploaded_by     uuid NOT NULL REFERENCES iam.users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);
```

## 4.10 Audit Schema (append-only)

```sql
CREATE TABLE audit.events (
  id              uuid DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid,
  actor_ip        inet,
  action          text NOT NULL,
  resource_type   text NOT NULL,
  resource_id     uuid,
  before          jsonb,
  after           jsonb,
  reason          text,
  signature       text,            -- HMAC of payload, chained
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

REVOKE UPDATE, DELETE ON audit.events FROM PUBLIC;
```

## 4.11 Row-Level Security (multi-tenancy)

```sql
ALTER TABLE incident.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON incident.incidents
USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_write ON incident.incidents
FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

The application sets `SET LOCAL app.tenant_id = '...'` at the start of every transaction, derived from the authenticated session. Platform admins use a privileged DB role that bypasses RLS for cross-tenant operations and writes a special audit row.

## 4.12 Partitioning

- `incident.timeline`, `chat.messages`, `audit.events`: monthly RANGE partitions managed by `pg_partman`.
- Retention policy: timeline 5y, chat 3y, audit 7y.
- Older partitions detached and moved to cold storage (S3-compatible) via nightly job.

---

# 5. API CONTRACTS

## 5.1 Conventions

- Base path: `/api/v1`
- All endpoints require `Authorization: Bearer <jwt>` unless under `/api/v1/auth`.
- Content-Type `application/json`. Multipart only for `/files`.
- All list endpoints support `?cursor=`, `?limit=` (default 50, max 200), `?sort=`, `?filter[…]=`.
- `Idempotency-Key` header supported on every POST that creates a resource.
- All responses include `X-Request-Id` for correlation.

## 5.2 Error Model

```json
{
  "error": {
    "code": "INCIDENT_INVALID_TRANSITION",
    "message": "Cannot close incident with open tasks.",
    "status": 422,
    "details": [
      { "field": "status", "issue": "open_tasks_exist", "count": 4 }
    ],
    "traceId": "01HX...",
    "docs": "https://docs.sentinel/errors/INCIDENT_INVALID_TRANSITION"
  }
}
```

Error code taxonomy: `<DOMAIN>_<REASON>`. HTTP status maps as: 400 validation, 401 auth missing, 403 forbidden, 404 not found, 409 conflict, 422 domain rule, 429 rate limit, 500 internal, 503 dependency down.

## 5.3 Pagination

Cursor-based using opaque base64 of `(sort_key, id)`. Response:

```json
{
  "data": [ ... ],
  "page": {
    "nextCursor": "eyJ0c...",
    "prevCursor": null,
    "limit": 50,
    "hasMore": true
  }
}
```

## 5.4 Endpoint Catalog (selected)

### Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | email+password, returns tokens, sets refresh cookie |
| POST | `/auth/refresh` | rotate access token |
| POST | `/auth/logout` | revoke session |
| POST | `/auth/mfa/enroll` | start TOTP/WebAuthn enroll |
| POST | `/auth/mfa/verify` | complete MFA challenge |
| GET  | `/auth/me` | session info, permissions, tenant |

### Incidents

| Method | Path | Purpose |
|---|---|---|
| GET    | `/incidents` | list (filterable by status, severity, bbox, range) |
| POST   | `/incidents` | create |
| GET    | `/incidents/:id` | get |
| PATCH  | `/incidents/:id` | update fields (validated by state machine) |
| POST   | `/incidents/:id/transitions` | execute state transition |
| POST   | `/incidents/:id/sitreps` | submit situation report |
| GET    | `/incidents/:id/timeline` | paginated timeline |
| POST   | `/incidents/:id/participants` | add participant |
| DELETE | `/incidents/:id/participants/:userId` | remove participant |
| POST   | `/incidents/:id/commander` | assign IC |

### Tasks

| Method | Path | Purpose |
|---|---|---|
| GET    | `/tasks` | list (filter by incident, assignee, status) |
| POST   | `/tasks` | create |
| PATCH  | `/tasks/:id` | update |
| POST   | `/tasks/:id/transitions` | state change |
| POST   | `/tasks/:id/assign` | assign user |
| POST   | `/tasks/:id/comments` | comment |

### Documents, Chat, GIS, Files, Admin — analogous; full OpenAPI in `/contracts/openapi.yaml`.

## 5.5 DTO Examples (NestJS, class-validator)

```ts
// CreateIncidentDto
export class CreateIncidentDto {
  @IsString() @Length(3, 200)         title!: string;
  @IsString() @Length(0, 5000) @IsOptional() description?: string;
  @IsIn(IncidentCategories)            category!: IncidentCategory;
  @IsInt() @Min(1) @Max(4)             severity!: 1|2|3|4;
  @IsInt() @Min(1) @Max(4) @IsOptional() classification?: 1|2|3|4;
  @ValidateNested() @Type(() => GeoPointDto) @IsOptional() epicenter?: GeoPointDto;
  @ValidateNested() @Type(() => GeoPolygonDto) @IsOptional() geofence?: GeoPolygonDto;
  @IsObject() @IsOptional()            metadata?: Record<string, unknown>;
}
```

## 5.6 Validation & State Machines

State transitions are guarded server-side by an XState machine per aggregate. The client never decides legality; it asks the server which transitions are *currently* valid via:

```
GET /incidents/:id/transitions/available
→ [ { code: "escalate", label: "Escalate", requires: ["reason"] }, ... ]
```

This drives the UI's "Available actions" buttons (no dead buttons).

---

# 6. EVENT SYSTEM

## 6.1 Naming Convention

`<domain>.<entity>.<action>.v<n>` — past tense, lowercase, dot-separated.
Examples: `incident.created.v1`, `task.sla_breached.v1`, `iam.user.deactivated.v1`.

Versioning is **never** removed. Breaking changes ship a `.v2` while `.v1` keeps publishing for at least 2 release cycles.

## 6.2 Envelope (all events)

```json
{
  "id": "01HX...",
  "type": "incident.severity_changed.v1",
  "occurredAt": "2026-04-12T09:14:22.345Z",
  "tenantId": "01HX...",
  "actor": { "type": "user", "id": "01HX...", "ip": "10.0.0.4" },
  "subject": { "type": "incident", "id": "01HX..." },
  "correlationId": "01HX...",
  "causationId": "01HX...",
  "data": { "from": 2, "to": 4, "reason": "casualties_reported" },
  "schema": "https://schemas.sentinel/incident/severity_changed/v1.json"
}
```

## 6.3 Catalog (excerpt)

| Event | Producer | Consumers | Notes |
|---|---|---|---|
| `incident.created.v1` | Incident | Notification, Analytics, Audit, Realtime, Chat (creates room) | |
| `incident.severity_changed.v1` | Incident | Notification (CRITICAL → siren), Analytics, Audit, Realtime | |
| `incident.closed.v1` | Incident | Task (validate none open), Document (auto-report), Analytics | |
| `task.sla_breached.v1` | Task scheduler | Notification, Realtime, Analytics | scheduled fired by job |
| `chat.message.posted.v1` | Chat | Realtime, Notification (mentions), Search index | |
| `file.uploaded.v1` | File | AV scanner | |
| `file.scanned.v1` | AV worker | File (status), originating producer | |
| `iam.breakglass.activated.v1` | IAM | Audit, Notification (admin alert) | |
| `gis.feature.updated.v1` | GIS | Realtime | |

## 6.4 Transport — NATS JetStream

- One stream per domain: `STREAM_INCIDENT`, `STREAM_TASK`, ...
- Subjects: `sentinel.<domain>.>`.
- Retention: `interest` for ephemeral, `limits` (7d, 100GB) for durable.
- Each consumer is **durable**, **explicit ack**, `MaxDeliver=8`, exponential backoff (1s → 2 → 4 → 8 → 16 → 32 → 64 → 128).
- After `MaxDeliver`, message routed to `STREAM_DLQ` with reason header.

## 6.5 Outbox Pattern

Producers never publish directly. They write to a `*_outbox` table in the same DB transaction as the business write. A relay process polls and publishes to NATS. This guarantees:
- exactly-once **delivery to NATS**
- at-least-once **delivery to consumers**
- **idempotency** is the consumer's responsibility (event id is the dedupe key, stored in a Redis set with 24h TTL).

```sql
CREATE TABLE incident.outbox (
  id          uuid PRIMARY KEY,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX idx_outbox_unpublished ON incident.outbox (created_at) WHERE published_at IS NULL;
```

## 6.6 DLQ Handling

- DLQ messages surface in the Admin Panel under "Event Health" with full envelope, last error, attempt count.
- Operator actions: **Replay**, **Edit & Replay**, **Drop with reason** (audited).
- Alert if DLQ depth > 100 or growth rate > 10/min.

## 6.7 Schema Registry

JSON Schemas live in `packages/contracts/events/`. CI fails if a producer publishes an event whose payload does not validate. Consumers validate on receive in non-prod, log-only in prod (for forward compatibility).

---

# 7. REALTIME

## 7.1 Architecture

- WebSocket gateway runs as a separate Nest process (`realtime-gateway`) behind sticky-session load balancer.
- Uses **Socket.IO with Redis adapter** for cross-node fan-out.
- Auth: client connects with the same JWT used for REST; gateway validates and binds `userId`, `tenantId`, `clearance` to the socket.
- All app events land in NATS first; the realtime gateway is itself a NATS consumer that pushes filtered events to WebSocket rooms.

```
NATS ──▶ Realtime Gateway ──▶ Socket.IO rooms ──▶ Clients
                  ▲
                  │ (Redis pub/sub for cross-node)
```

## 7.2 Subscription Model

Clients **do not** ask for raw streams. They subscribe to **scopes**:

| Scope | Example | Receives |
|---|---|---|
| `tenant` | implicit | tenant-wide broadcasts (CRITICAL alerts) |
| `user` | implicit | personal notifications |
| `incident:{id}` | `incident:01HX...` | timeline, sitreps, participants, status |
| `channel:{id}` | `channel:01HX...` | chat messages |
| `map:bbox` | `map:bbox:34.1,71.2,34.5,71.7` | feature updates within bbox |

Server enforces ABAC at subscribe time and re-checks on every fan-out. A user who loses access mid-session is force-unsubscribed within 1s.

## 7.3 Message Format

```json
{ "type": "incident.timeline.appended", "scope": "incident:01HX...", "data": { ... }, "v": 1 }
```

## 7.4 Resync Strategy

Networks fail. The protocol is built for it.

1. Each client tracks `lastEventId` per scope.
2. On reconnect, client sends `resync { scope, lastEventId }`.
3. Server replays missed events from a 5-minute Redis stream buffer (one stream per scope).
4. If `lastEventId` is older than buffer → server replies `resync_full_required`. Client refetches the resource via REST and resubscribes.

This avoids the "ghost incident" problem where the operator sees stale state after a flaky connection.

## 7.5 Scaling

- Target 50k concurrent sockets per pod, ~10 pods at peak.
- Backpressure: per-socket outbound queue capped at 256 messages; overflow disconnects with code `4290_BACKPRESSURE` and forces resync.
- Heartbeat 25s, timeout 60s.

---

# 8. CALL SYSTEM (mediasoup)

## 8.1 Why mediasoup

We need an SFU we can host on-prem, that supports simulcast, recording, and 50+ participants per room. mediasoup is C++/Node, well-maintained, and has no external dependencies on cloud services.

## 8.2 Topology

```
Clients ─WebRTC─▶ mediasoup Workers ◀──signaling── NestJS Signaling Service
                      │
                      └─RTP─▶ Recording Worker (FFmpeg) ──▶ MinIO
```

- Each physical node runs N mediasoup Workers (1 per CPU core).
- Each call (`Router`) is pinned to one worker; participants beyond ~50 are split across workers in a Pipe topology.
- Signaling done over the existing Socket.IO gateway, namespace `/calls`.

## 8.3 Signaling Protocol (selected)

| Client → Server | Server → Client |
|---|---|
| `call:join { incidentId }` | `call:routerRtpCapabilities { ... }` |
| `call:createTransport { direction }` | `call:transportCreated { ... }` |
| `call:connectTransport { dtlsParameters }` | `call:transportConnected` |
| `call:produce { kind, rtpParameters }` | `call:produced { producerId }` |
| `call:consume { producerId }` | `call:consumed { ... }` |
| `call:leave` | `call:participantLeft` |

## 8.4 Recording

- Optional per call (default ON for incidents with severity ≥ HIGH).
- Recording worker plays the role of a server-side consumer, pipes RTP into FFmpeg → MP4 (H.264 + AAC).
- Recording metadata (start/end, participants, duration) stored in `call.sessions.recording_file_id`.
- Stored in MinIO with object lock (WORM) for audit.

## 8.5 Scaling

- Horizontal scaling by adding mediasoup nodes; signaling service is stateless.
- A coordinator (Redis) tracks `node → worker → router` mapping for room placement.
- BodyCam push-streaming supported via WHIP ingest endpoint feeding into mediasoup as a non-renegotiating producer.

## 8.6 Network

- ICE on UDP 40000–49999 (configurable).
- TURN fallback (coturn) for restricted field networks.
- TLS termination at edge; mediasoup uses DTLS-SRTP end-to-end inside.

---

# 9. DOCUMENT WORKFLOW

## 9.1 State Machine

```
        ┌──────┐  submit  ┌────────┐  approve  ┌──────────┐  publish  ┌───────────┐
        │DRAFT │─────────▶│ REVIEW │──────────▶│ APPROVED │──────────▶│ PUBLISHED │
        └──┬───┘          └───┬────┘           └────┬─────┘           └─────┬─────┘
           │ reject ◀─────────┘ reject              │                       │
           │ ◀───────────────────────────────────── │                       │
           │                                        │                       │
           │                                        ▼                       ▼
           │                                  ┌──────────┐            ┌──────────┐
           │                                  │ ARCHIVED │            │ REVOKED  │
           │                                  └──────────┘            └──────────┘
           ▼
       (any time)
       NEW VERSION → returns to DRAFT
```

Rules:
- `APPROVED` is locked: any change forces a new version starting at DRAFT.
- `PUBLISHED` is the only state visible to non-authors.
- `REVOKED` writes a tombstone version with reason; older versions remain accessible to auditors.

## 9.2 Approvals

Templates declare an approval policy:

```yaml
template: incident_situation_report_v1
approvals:
  - role: shift_lead
    quorum: 1
  - role: incident_commander
    quorum: 1
signatures:
  - role: incident_commander
    method: webauthn   # hardware-backed
```

Approvers see a focused approval inbox; one click opens a side-by-side diff (vs previous approved version).

## 9.3 Versioning

- Each version is an immutable file in MinIO referenced by `document.versions.content_file_id`.
- SHA-256 stored and verified on every read.
- Diff rendering for `.docx` via server-side render → HTML → diff (using `jsdiff`).
- For PDFs: page-level visual diff with overlay.

## 9.4 Generation

Templates support placeholders bound to incident data:

```
{{incident.code}} — {{incident.title}}
Severity: {{incident.severity | severityLabel}}
Opened: {{incident.opened_at | datetime}}
```

Rendered server-side via a sandboxed worker; output is always a versioned file.

---

# 10. ANALYTICS

## 10.1 ETL Pipeline

```
Source events (NATS) ──▶ Analytics Consumer ──▶ Staging tables
                                                    │
                                                    ▼
                                          Materialized facts/dims
                                                    │
                                                    ▼
                                          OpenSearch (search/explore)
```

- Consumer is idempotent on `event.id`.
- Facts written in batches every 5s or 1000 rows, whichever first.
- Materialized views refreshed concurrently every 60s.

## 10.2 Star Schema (selected)

```sql
CREATE TABLE analytics.dim_time (
  date_key   date PRIMARY KEY,
  year       int, quarter int, month int, day int, dow int,
  is_weekend boolean
);

CREATE TABLE analytics.dim_user (
  user_id   uuid PRIMARY KEY,
  tenant_id uuid,
  role_codes text[],
  region    text
);

CREATE TABLE analytics.fact_incident (
  incident_id   uuid PRIMARY KEY,
  tenant_id     uuid,
  category      text,
  severity      smallint,
  opened_at     timestamptz,
  closed_at     timestamptz,
  duration_sec  integer,
  task_count    int,
  participants  int,
  region        text
);

CREATE TABLE analytics.fact_task_sla (
  task_id       uuid PRIMARY KEY,
  incident_id   uuid,
  due_at        timestamptz,
  completed_at  timestamptz,
  breached      boolean,
  delay_sec     integer
);
```

## 10.3 Dashboards

- **Operational** (Shift Lead): open incidents, SLA breaches now, response time p50/p95.
- **Tactical** (IC): per-incident burn-down of tasks, time to first response, comm volume.
- **Strategic** (Ministry): trend by category, regional heat-map, MTTR over time, drills vs real.

All built as Sentinel-native React pages on top of `/api/v1/analytics/*`. No third-party BI tool exposed to end users (audit and access control reasons). For analysts, an internal SQL workbench is exposed against a **read-replica** of analytics schema only.

## 10.4 Reporting

- Scheduled report jobs (daily, weekly, monthly, post-incident) render to PDF via the document workflow.
- Post-incident report auto-compiled within 60s of incident close: timeline summary, KPIs, screenshots of map at key moments, list of decisions.

---

# 11. IAM (DEEP)

## 11.1 Model

- **RBAC** for coarse permissions (system roles, daily operations).
- **ABAC** for context-sensitive decisions ("this commander on this incident", "this clearance level on this document").
- Both evaluated by a single PDP (Policy Decision Point) inside the IAM module.

## 11.2 Permission Catalog (excerpt)

```
incident.read
incident.create
incident.update.status
incident.assign.commander
incident.classify.{public,internal,confidential,secret}
task.read
task.create
task.assign
document.read
document.approve
chat.read.incident
chat.post
gis.layer.publish
admin.user.manage
admin.role.manage
admin.policy.manage
audit.read
```

## 11.3 System Roles

| Role | Key permissions |
|---|---|
| `duty_operator` | incident.create, incident.read, sitrep.create, chat.post |
| `shift_lead` | + incident.assign.commander, task.assign, document.approve (level 1) |
| `incident_commander` | + incident.update.status, task.create, task.assign, document.approve (level 2), call.start |
| `field_responder` | sitrep.create, chat.post, task.read (own), file.upload |
| `gis_analyst` | gis.* |
| `agency_liaison` | incident.read (scoped), chat.post, task.read |
| `analyst` | analytics.read |
| `tenant_admin` | admin.user.manage (own tenant), admin.role.manage (own tenant) |
| `platform_admin` | admin.* (all tenants), system tasks |
| `auditor` | audit.read (all tenants), read-only |

## 11.4 ABAC Policies

Policies are JSON objects. Example:

```json
{
  "name": "incident-secret-clearance",
  "effect": "allow",
  "actions": ["incident.read", "incident.update.*"],
  "resources": ["incident:*"],
  "condition": {
    "all": [
      { "stringEquals": { "subject.tenant_id": "resource.tenant_id" } },
      { "numericGte": { "subject.clearance": "resource.classification" } }
    ]
  }
}
```

```json
{
  "name": "commander-can-write-own-incident",
  "effect": "allow",
  "actions": ["incident.update.*", "task.create", "task.assign"],
  "resources": ["incident:${resource.id}"],
  "condition": {
    "stringEquals": { "subject.id": "resource.commander_id" }
  }
}
```

## 11.5 Evaluation Flow

```
Request ─▶ Gateway extracts JWT ─▶ AuthGuard
                                       │
                                       ▼
                              Build evaluation context
                              { subject, action, resource, env }
                                       │
                                       ▼
                                ┌──── PDP ────┐
                                │ 1. Deny wins│
                                │ 2. Explicit │
                                │   allow > * │
                                │ 3. Default  │
                                │   deny      │
                                └─────────────┘
                                       │
                              Decision + obligations
                                       │
                       ┌───────────────┴─────────────┐
                       ▼                             ▼
                   Allowed                       Denied (403)
              (handler runs)                 audit.access_denied
```

PDP results are cached in Redis keyed by `(subject_version, policy_version, action, resource_id)` for 30s. Any policy change bumps `policy_version`, invalidating cache instantly.

## 11.6 Break-Glass Access

- Designated users have `break_glass` capability — *latent*, requires explicit activation.
- Activation: user provides reason, MFA challenge, supervisor co-sign within 60s, auto-expires in 4h.
- During break-glass, user temporarily inherits a defined elevated role (typically `incident_commander` for a specific incident).
- Every action in break-glass mode is tagged in audit with `breakglass=true` and reviewed within 24h.
- A red banner is shown across the UI for the duration of the session.

---

# 12. SECURITY

## 12.1 Threat Model (STRIDE, abridged)

| Threat | Mitigation |
|---|---|
| **Spoofing** — stolen tokens | Short-lived access (10 min), refresh rotation, device binding hash, MFA |
| **Tampering** — request tampering | mTLS at edge for partner integrations, request signing for critical mutations |
| **Repudiation** — "I didn't do that" | Tamper-evident audit log (HMAC chain), MFA on sensitive actions, video recording in break-glass |
| **Information disclosure** — cross-tenant leak | RLS in DB + ABAC at app + scope filter at WS |
| **DoS** — traffic flood | Edge rate limit, per-user quota, WebSocket backpressure, autoscaling |
| **Elevation of privilege** — role escalation | Two-person rule for `platform_admin`, append-only role grant log, periodic access review |
| **Supply chain** — npm dependency | Locked versions, SBOM, Snyk scan in CI, signed images |
| **Injection** — SQL/NoSQL | Parameterized queries (TypeORM/Drizzle), no string interpolation, schema validation on every input |

## 12.2 Auth Lifecycle

- Login: email + password → if MFA enrolled, MFA challenge → access (10 min) + refresh (8 h) tokens.
- Refresh tokens are rotated on every use; reuse detection invalidates the entire family and forces re-login (Token Theft Detection).
- Sessions can be revoked per device from the user profile.
- SSO (OIDC) supported with Keycloak/AzureAD/whatever the ministry runs; SSO users still subject to MFA policy.
- WebAuthn (security keys) supported and required for `platform_admin` and break-glass.

## 12.3 Encryption

- **In transit:** TLS 1.3 everywhere, HSTS, internal mTLS between services.
- **At rest:** PostgreSQL with `pg_tde` or LUKS at the volume layer; MinIO with SSE-S3; backups encrypted with separate KMS key.
- **Key management:** HashiCorp Vault or HSM (Yubico/Thales) for sovereign deployments; per-tenant data keys derived from master.
- **Secrets:** Vault dynamic secrets for DB; no plaintext secrets in env files or git.
- **Field-level:** PII fields (phone, full_name) optionally encrypted with per-tenant key for high-classification tenants.

## 12.4 Rate Limits

| Surface | Default | Burst |
|---|---|---|
| Public auth (`/auth/login`) | 5 / min / IP | 10 |
| Authenticated read | 600 / min / user | 1200 |
| Authenticated write | 120 / min / user | 240 |
| File upload | 30 / min / user | 60 |
| WebSocket subscribe | 200 / min / socket | 400 |

Implemented with Redis token bucket; limits are higher for `incident_commander` and `field_responder` during open critical incidents.

## 12.5 Hardening Checklist

- CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin.
- All cookies `HttpOnly`, `Secure`, `SameSite=Strict`.
- File uploads scanned by ClamAV before becoming reachable; MIME sniffing forbidden.
- Inputs validated by class-validator; outputs serialized by class-transformer (no leaking fields).
- Dependency lockfiles + Renovate weekly + automated CVE bot.
- Pen-tested annually; bug bounty for sovereign installs.

---

# 13. OBSERVABILITY

## 13.1 Logs

- Structured JSON via `pino`, fields: `ts, level, msg, requestId, tenantId, userId, route, latencyMs`.
- No PII in logs.
- Shipped to OpenSearch via Vector.
- Retention 30d hot, 1y warm, 7y cold for audit-related.

## 13.2 Metrics

- Prometheus, scraped from each pod's `/metrics`.
- Standard four golden signals per service: latency, traffic, errors, saturation.
- Domain metrics: `incidents_open`, `tasks_overdue`, `events_dlq_depth`, `ws_connected`, `mediasoup_active_calls`.
- Dashboards in Grafana, alerting via Alertmanager → PagerDuty/OpsGenie + internal notification rules.

## 13.3 Tracing

- OpenTelemetry SDK in every NestJS service.
- Auto-instrumentation: HTTP, NATS, PostgreSQL, Redis, S3.
- Spans propagated through events via `traceparent` in event envelope (so an event consumer's spans link back to the originating request).
- Sampling: 100% for errors, 10% for normal, 100% for incidents with severity ≥ HIGH (forced via baggage).

## 13.4 Health & Readiness

- `/healthz` (liveness), `/readyz` (readiness).
- Each module reports its dependencies (DB, NATS, Redis, MinIO).
- Status page (internal) showing per-component status, derived from health probes.

## 13.5 Frontend Observability

- Web Vitals (LCP, INP, CLS) shipped per route.
- Source-mapped error reporting via Sentry-compatible self-hosted GlitchTip.
- Session replay disabled by default (privacy); enabled per tenant with consent.

---

# 14. DEVOPS

## 14.1 Repo Layout (monorepo, pnpm + nx)

```
sentinel/
├── apps/
│   ├── api/                 # NestJS modular monolith
│   ├── realtime/            # Realtime gateway
│   ├── workers/             # Background workers
│   ├── sfu/                 # mediasoup signaling
│   └── web/                 # Next.js
├── packages/
│   ├── contracts/           # OpenAPI + event schemas
│   ├── ui/                  # shared shadcn-based components
│   ├── design-tokens/
│   ├── eslint-config/
│   └── tsconfig/
├── infra/
│   ├── docker/
│   ├── k8s/
│   └── terraform/
└── docs/
```

## 14.2 Dockerfiles (excerpt)

```dockerfile
# apps/api/Dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm --filter @sentinel/api build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/main.js"]
```

## 14.3 docker-compose (dev)

```yaml
version: "3.9"
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment: { POSTGRES_PASSWORD: dev }
    ports: ["5432:5432"]
    volumes: [pg:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000","9001:9001"]
  nats:
    image: nats:2.10-alpine
    command: ["-js"]
    ports: ["4222:4222","8222:8222"]
  opensearch:
    image: opensearchproject/opensearch:2
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true
    ports: ["9200:9200"]
  api:
    build: ./apps/api
    depends_on: [postgres, redis, nats, minio]
    env_file: .env
    ports: ["3000:3000"]
  realtime:
    build: ./apps/realtime
    depends_on: [redis, nats]
    ports: ["3001:3001"]
  web:
    build: ./apps/web
    depends_on: [api]
    ports: ["3002:3000"]
volumes: { pg: {} }
```

## 14.4 CI/CD

GitHub Actions / GitLab CI pipeline:

1. `lint` — eslint, prettier, type-check.
2. `test` — unit tests (vitest), integration tests (Testcontainers spin postgres/nats/redis), contract tests against OpenAPI + event schemas.
3. `build` — docker buildx, multi-arch (amd64+arm64), pushes to registry tagged with commit sha.
4. `scan` — Trivy image scan, Snyk dep scan, SBOM (cyclonedx), cosign sign image.
5. `deploy:staging` — Argo CD syncs k8s manifests pointing at new tag.
6. `e2e` — Playwright suite against staging.
7. `deploy:prod` — manual approval; canary 5% → 25% → 100% with auto-rollback on SLO breach.

## 14.5 Kubernetes Readiness

- One Helm umbrella chart `sentinel/` with subcharts per service.
- HPA based on CPU + custom metric (`ws_connected`, `events_lag`).
- PodDisruptionBudget min available 1 per service.
- NetworkPolicies: default-deny, explicit allow lists between namespaces.
- Sealed Secrets / External Secrets via Vault.
- StorageClasses: `fast-ssd` for postgres/redis, `bulk` for MinIO and partitions cold.
- For sovereign on-prem: same chart, swap StorageClass and ingress; no cloud-specific objects.

---

# 15. RESILIENCE

## 15.1 Retries

- HTTP clients use exponential backoff (50ms → 1.6s, 5 attempts) with jitter.
- Idempotent writes carry `Idempotency-Key`; non-idempotent ones never auto-retry.
- NATS consumers retry with backoff per §6.4.

## 15.2 Circuit Breakers

- Every external integration wrapped with `opossum` circuit breaker:
  - failure threshold 50% over 20 requests
  - open for 30s
  - half-open with 1 probe
- Open circuit returns a typed `DependencyUnavailableError` and the calling handler renders a degraded UI ("Weather feed unavailable, retrying").

## 15.3 Bulkheads

- Workers and request handlers run in separate pools so a slow PDF render can't starve API requests.
- DB connection pools per module with caps; exceeding cap returns 503 fast.

## 15.4 Graceful Degradation Matrix

| Failure | Behaviour |
|---|---|
| OpenSearch down | Fallback to PostgreSQL `pg_trgm` for search, banner shown |
| NATS down | Outbox accumulates; UI shows "Sync paused"; events flush on recovery |
| MinIO down | Uploads queued client-side, retried on reconnect |
| Realtime gateway down | UI auto-falls back to 5s polling; "Live updates paused" pill |
| One DB replica down | Reads route to other replicas; writes unaffected |
| Primary DB down | Promote standby; max 60s |

## 15.5 Disaster Recovery

- **Backups:** WAL streaming + 6-hourly base backups, kept 30 days locally + 90 days off-site.
- **DR site:** warm standby, async replication, lag monitored.
- **RPO ≤ 60 s, RTO ≤ 15 min.**
- **DR drill** quarterly: full failover exercise with measured times, results filed as a post-incident report inside Sentinel itself.
- **Game days:** monthly chaos engineering — kill random pods, partition NATS, throttle DB — and observe SLOs hold.

---

# 16. UI / UX DESIGN

> This section is the **product**. Engineers, designers, PMs: this is the bar.
> Reference points: Linear (clarity, motion, density), Vercel (typography, restraint), Datadog (information density done right), Notion (hierarchy), Palantir Foundry (operational primitives). **Not** SharePoint, **not** legacy gov UI, **not** Bootstrap dashboards.

## 16.1 Design Pillars

1. **Glanceable.** Every screen answers "what should I do next?" in under 3 seconds.
2. **Calm but alive.** Realtime updates are felt, not screamed (subtle motion, never modal popups for incoming events).
3. **Dense by default, expandable on demand.** Progressive disclosure — not infinite drilldowns.
4. **Keyboard-first.** Every primary action has a shortcut. Cmd-K is sacred.
5. **Honest UI.** No skeuomorphism, no fake gradients, no decorative gauges. Data is the decoration.
6. **Accessible.** WCAG 2.2 AA minimum, 4.5:1 contrast, focus rings always visible, screen reader paths tested.

## 16.2 UI Architecture (Layout System)

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP BAR  (48px)                                                │
│  [Logo][Tenant▾]    [Cmd-K Search ........]    [Status][User▾]  │
├──────────┬──────────────────────────────────────────┬───────────┤
│          │                                          │           │
│ SIDEBAR  │                CONTENT                   │  RIGHT    │
│ (240px / │                                          │  PANEL    │
│  64px    │           (12-col grid, 24px gutter)     │  (360px,  │
│  collap.)│                                          │  optional)│
│          │                                          │           │
│          │                                          │           │
│          │                                          │           │
└──────────┴──────────────────────────────────────────┴───────────┘
```

- **Top bar:** persistent, 48px tall, contains tenant switcher (multi-tenant only), global Cmd-K, system status pill, user menu.
- **Sidebar:** collapsible (240 ↔ 64). Sections: Dashboard, Incidents, Tasks, Map, Documents, Chat, Analytics, Admin. Each item has an icon (Lucide) + label + badge for live counts.
- **Content:** 12-column grid, 24px gutters, max-width 1600px on ultra-wide.
- **Right panel:** contextual (incident details, task details, file preview). Closeable. Persistent state per route.
- **No modals for primary flows.** Modals only for destructive confirmation or one-shot inputs.

### Routing (Next.js App Router)

```
app/
├── (auth)/login/page.tsx
├── (app)/layout.tsx                  ← shell: topbar + sidebar
│   ├── dashboard/page.tsx
│   ├── incidents/
│   │   ├── page.tsx                  ← list
│   │   ├── new/page.tsx
│   │   └── [id]/
│   │       ├── layout.tsx            ← incident shell w/ tabs
│   │       ├── page.tsx              ← overview
│   │       ├── timeline/page.tsx
│   │       ├── tasks/page.tsx
│   │       ├── documents/page.tsx
│   │       ├── chat/page.tsx
│   │       └── map/page.tsx
│   ├── tasks/page.tsx
│   ├── map/page.tsx
│   ├── documents/page.tsx
│   ├── chat/[channelId]/page.tsx
│   ├── analytics/page.tsx
│   └── admin/
│       ├── users/page.tsx
│       ├── roles/page.tsx
│       ├── policies/page.tsx
│       └── tenants/page.tsx
└── (public)/status/page.tsx
```

## 16.3 Design System

### 16.3.1 Color (OKLCH-based, dark + light)

We use OKLCH for perceptual uniformity. All tokens defined as CSS variables; shadcn theme variables map to them.

**Light theme**

| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(99% 0.005 240)` | app background |
| `--bg-elev-1` | `oklch(100% 0 0)` | cards, panels |
| `--bg-elev-2` | `oklch(98% 0.005 240)` | sidebar |
| `--border` | `oklch(92% 0.01 240)` | dividers |
| `--border-strong` | `oklch(86% 0.015 240)` | inputs |
| `--fg` | `oklch(20% 0.02 240)` | primary text |
| `--fg-muted` | `oklch(45% 0.02 240)` | secondary text |
| `--fg-subtle` | `oklch(60% 0.015 240)` | helper text |
| `--primary` | `oklch(55% 0.18 255)` | brand, primary actions (deep blue) |
| `--primary-fg` | `oklch(99% 0.005 255)` | text on primary |
| `--success` | `oklch(62% 0.16 150)` | success states |
| `--warning` | `oklch(75% 0.16 75)` | warnings, SLA risk |
| `--danger` | `oklch(58% 0.22 25)` | errors, CRITICAL |
| `--info` | `oklch(65% 0.13 220)` | info |
| `--severity-1` | `oklch(70% 0.12 145)` | LOW |
| `--severity-2` | `oklch(75% 0.16 75)` | MODERATE |
| `--severity-3` | `oklch(65% 0.20 40)` | HIGH |
| `--severity-4` | `oklch(55% 0.24 25)` | CRITICAL |

**Dark theme** (preferred default for ops rooms)

| Token | Value |
|---|---|
| `--bg` | `oklch(14% 0.01 240)` |
| `--bg-elev-1` | `oklch(17% 0.012 240)` |
| `--bg-elev-2` | `oklch(20% 0.014 240)` |
| `--border` | `oklch(26% 0.02 240)` |
| `--border-strong` | `oklch(34% 0.025 240)` |
| `--fg` | `oklch(96% 0.005 240)` |
| `--fg-muted` | `oklch(72% 0.015 240)` |
| `--fg-subtle` | `oklch(55% 0.02 240)` |
| `--primary` | `oklch(70% 0.17 255)` |
| `--danger` | `oklch(68% 0.22 25)` |

Severity colors are the **only** use of saturated red/orange in the UI. This protects their meaning. Buttons, links, charts use the cooler blue palette.

### 16.3.2 Spacing Scale

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 80` (px). Tailwind config maps `1=4`, `2=8`, etc. **No arbitrary values** in production code (eslint rule).

### 16.3.3 Typography Scale

Font: **Inter** (UI) + **JetBrains Mono** (code/IDs/timestamps).

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display` | 32 / 40 | 600 | hero numbers in dashboards |
| `h1` | 24 / 32 | 600 | page title |
| `h2` | 20 / 28 | 600 | section title |
| `h3` | 16 / 24 | 600 | card title |
| `body` | 14 / 20 | 400 | default body |
| `small` | 13 / 18 | 400 | secondary |
| `xs` | 12 / 16 | 500 | labels, badges |
| `mono` | 13 / 18 | 500 | IDs, codes, times |

Letter-spacing tightened slightly on headings (`-0.01em`).

### 16.3.4 Density

Two modes, user-toggleable, default **compact** for ops, **comfortable** for admin/analyst:

| Token | Compact | Comfortable |
|---|---|---|
| Row height (table) | 36px | 44px |
| Input height | 32px | 38px |
| Button height | 32px | 36px |
| Card padding | 16px | 24px |

### 16.3.5 Border Radius & Shadows

- Radius: `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`. **No fully rounded buttons.** No rounded-2xl meme look.
- Shadows are restrained:
  - `--shadow-1: 0 1px 2px oklch(0% 0 0 / 0.06)`
  - `--shadow-2: 0 4px 12px oklch(0% 0 0 / 0.08)`
  - `--shadow-3: 0 12px 32px oklch(0% 0 0 / 0.12)` (popovers only)
- Cards have a 1px border *or* a shadow, never both.

### 16.3.6 Motion

- Durations: 120 / 180 / 240 ms. Anything longer than 300ms is a bug.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo) for entrances, linear for progress.
- Realtime arrivals: a 240ms subtle highlight wash + 4px slide-in. No bounces, no sparkles.
- `prefers-reduced-motion` honored everywhere.

### 16.3.7 Tables (the workhorse)

Sentinel runs on tables. They follow a strict pattern:

- Sticky header.
- Zebra stripes off by default; replaced by 1px row dividers.
- Column types: `text`, `number` (right-aligned, mono), `status` (pill), `relative-time`, `user`, `severity`.
- Inline row actions appear on hover at the right edge; on touch, swipe left.
- Selection: checkbox + shift-click range + Cmd-A.
- Bulk-action bar slides in from the bottom when ≥1 row selected.
- Sort, filter, group: live in a single toolbar above the table; saved as **Views** (Linear-style).
- Empty states: never just "No data" — always a sentence + a primary action.

### 16.3.8 Forms

- Single-column layouts for everything ≤ 8 fields.
- Labels above inputs, helper text below, error inline (red-600 + icon, never just color).
- Required fields marked with a small dot, not an asterisk.
- Save bar pinned to the bottom of the panel — disabled until valid, shows "Unsaved changes" pill when dirty.
- All forms support Cmd-Enter to submit, Esc to cancel.

## 16.4 Component Principles

- **Built on shadcn/ui.** We extend, never fork. Each component lives in `packages/ui` with:
  - the shadcn primitive
  - an Sentinel-themed wrapper
  - a Storybook entry with all variants
- **No visual clutter.** Max 3 actions per card header; everything else in a `…` menu.
- **Consistent spacing.** Padding inside a card is *always* 16 (compact) or 24 (comfortable). Never bespoke.
- **Predictable interactions.** Same pattern for "open detail" everywhere: clicking a row opens the right panel; clicking the icon-link opens the full page.

## 16.5 Core Screens — Wireframes

### 16.5.1 Dashboard (Control Center)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Top bar                                                                    │
├──┬─────────────────────────────────────────────────────────────────────────┤
│  │  Good morning, Asyl. 3 incidents need your attention.        [Filters▾] │
│  │  ───────────────────────────────────────────────────────────────────────│
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ │ OPEN       │ │ CRITICAL   │ │ SLA AT RISK│ │ ON DUTY    │             │
│  │ │   12       │ │    2       │ │    5       │ │   18 / 22  │             │
│  │ │ +3 / 24h   │ │ +1         │ │ -2         │ │            │             │
│  │ └────────────┘ └────────────┘ └────────────┘ └────────────┘             │
│  │                                                                         │
│  │ ┌─────────────────────────────────────┐ ┌─────────────────────────────┐ │
│  │ │  ACTIVE INCIDENTS                   │ │  LIVE MAP                   │ │
│  │ │ ───────────────────────────────────│ │  ┌───────────────────────┐  │ │
│  │ │ 🔴 EQ-2026-04-1234  Earthquake M6.2│ │  │   [PostGIS preview]   │  │ │
│  │ │ 🟠 FL-2026-04-0980  Flood — Vahdat │ │  │   pins · heatmap      │  │ │
│  │ │ 🟡 FR-2026-04-0871  Wildfire Rasht │ │  │                       │  │ │
│  │ │ 🟢 OB-2026-04-0644  Drill          │ │  └───────────────────────┘  │ │
│  │ └─────────────────────────────────────┘ └─────────────────────────────┘ │
│  │                                                                         │
│  │ ┌─────────────────────────┐ ┌──────────────────┐ ┌────────────────────┐│
│  │ │ TASKS — DUE TODAY (8)   │ │ COMM ACTIVITY    │ │ SLA WARNINGS       ││
│  │ │ ▢ Dispatch SAR team #4  │ │ #incident-1234   │ │ Task 882: in 12m  ⚠ ││
│  │ │ ▢ Brief regional admin  │ │  ●●●●● 47 msgs   │ │ Task 901: in 38m  ⚠ ││
│  │ │ ▢ ...                   │ │ #flood-room      │ │                    ││
│  │ └─────────────────────────┘ └──────────────────┘ └────────────────────┘│
│  │                                                                         │
└──┴─────────────────────────────────────────────────────────────────────────┘
```

Key behaviors:
- KPI cards are clickable, route to filtered list.
- Active incidents row hover → right panel preview; click → full page.
- Map preview is **interactive** (pan/zoom) but compact; "Open full map" link.
- New CRITICAL incident: top of the list flashes a 240ms wash + an audible chirp **only** if user is `duty_operator` or `shift_lead`.

### 16.5.2 Incident Page (THE most important screen)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀ Incidents / EQ-2026-04-1234   Earthquake M6.2 · Vahdat   [Open] [⋯]      │
│ Severity: ●●●● CRITICAL    Commander: A. Karimov    Opened 14m ago         │
├──────────────────────┬─────────────────────────────┬───────────────────────┤
│                      │  Overview · Timeline · Tasks │   TASKS · CHAT · DOC │
│                      │   Map · Documents · Chat     │   ┌────────────────┐ │
│                      │ ────────────────────────────│   │ ▢ Dispatch SAR │ │
│      ┌──────────┐    │  📍 Vahdat district          │   │ ▢ Brief MoH    │ │
│      │          │    │  👥 24 participants          │   │ ▢ Set up shelt │ │
│      │   GIS    │    │  🏷  earthquake · M6.2       │   │ ▢ ...          │ │
│      │   MAP    │    │                              │   └────────────────┘ │
│      │  (live)  │    │  TIMELINE                    │                       │
│      │  pins    │    │ ─────────────                │   ┌────────────────┐ │
│      │  layers  │    │ 14m ago  🟢 created          │   │ #incident-1234 │ │
│      │  drawing │    │ 13m ago  ⚙  severity → HIGH  │   │ A: SAR team... │ │
│      │          │    │ 11m ago  ⚙  severity → CRIT  │   │ B: ETA 12m     │ │
│      │          │    │  9m ago  👤 commander A.K.   │   │ ...            │ │
│      │          │    │  8m ago  📝 sitrep #1        │   └────────────────┘ │
│      │          │    │  6m ago  📎 document Order#1 │                       │
│      │          │    │  ...                         │   ┌────────────────┐ │
│      └──────────┘    │                              │   │ DOCUMENTS (3)  │ │
│  Layers ▾  Draw  ⤢   │  [+ Add note]                │   │ Order #1  pub  │ │
│                      │                              │   │ Sitrep #1 draft│ │
│                      │                              │   └────────────────┘ │
└──────────────────────┴─────────────────────────────┴───────────────────────┘
```

Layout rules:
- **3-pane:** Map (40%) | Timeline/Details (40%) | Side rail (20%).
- The 3 panes are **resizable** with drag handles; layout persisted per user.
- On <1280px width, the side rail collapses into a tabbed strip.
- Real-time updates: timeline new entry slides in at top with a 240ms wash; tasks reorder live; chat shows typing indicators.

Quick actions (always 2 clicks max):
- `T` → New task
- `S` → New sitrep
- `D` → New document from template
- `C` → Open call (mediasoup)
- `Cmd-Shift-E` → Escalate severity
- `Cmd-K` → Search anything

The header shows **Available transitions** as buttons (not dropdowns) — derived from the state machine. No dead buttons.

### 16.5.3 Task Board

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Tasks    [Board] [List] [Calendar]   Filter: Incident=EQ-1234   [+ New ⌘N] │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──TODO──(7)──┐ ┌─IN PROGRESS─(4)─┐ ┌──BLOCKED──(1)─┐ ┌──REVIEW──┐ ┌─DONE─┐│
│ │ □ Dispatch  │ │ ▶ Set up shelter│ │ ⛔ Awaiting   │ │ ✓ Brief  │ │ ✓ ...│ │
│ │   SAR team  │ │   @ Karimov     │ │  fuel supply  │ │  regional│ │      │ │
│ │   ●●● HIGH  │ │   ⏱ 1h 12m      │ │  @ Iskandarov │ │ @ Akimov │ │      │ │
│ │ ⚠ SLA 14m   │ │   ░░░░░░░░ 60%  │ │               │ │          │ │      │ │
│ │             │ │                 │ │               │ │          │ │      │ │
│ │ □ Brief MoH │ │ ▶ Field assess. │ │               │ │          │ │      │ │
│ │   ●●  MED   │ │   @ Saidov      │ │               │ │          │ │      │ │
│ │             │ │                 │ │               │ │          │ │      │ │
│ │ ...         │ │ ...             │ │               │ │          │ │      │ │
│ └─────────────┘ └─────────────────┘ └───────────────┘ └──────────┘ └──────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

- Cards are dense: title, assignee avatar, priority dots, SLA pill, progress bar (only if subtasks), dependency icon.
- Drag-drop with optimistic update + rollback on server reject (state machine guards transitions).
- **List** view = same data, denser, sortable, more columns.
- **Calendar** view = SLA breach times on timeline.
- **Views** are saved per user with name, filter, grouping, sort. Switching is instant.

### 16.5.4 Document System

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Documents          [+ New from template ⌘N]   [Filters ▾]   [Search ⌘K]    │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ FOLDERS      │  Name                          Owner    Status      Updated│
│  All         │  📄 Order #2026-1234           A.K.     PUBLISHED   2m ago │
│  Incidents   │  📄 Situation Report #3        A.S.     REVIEW      14m   │
│  Templates   │  📄 Evacuation Plan v4         R.I.     APPROVED    1h    │
│  Drafts      │  📄 Sitrep #2                  A.S.     DRAFT       3h    │
│  Approved    │  ...                                                      │
│  Archive     │                                                            │
│              │                                                            │
│ INCIDENTS    │  Right panel preview when row selected:                    │
│  EQ-1234     │  ┌───────────────────────────────────────────┐             │
│  FL-0980     │  │  Order #2026-1234                          │             │
│              │  │  v3 · published · A. Karimov               │             │
│              │  │  ───────────────────────────────────────  │             │
│              │  │  [Document preview / page thumbnails]      │             │
│              │  │                                            │             │
│              │  │  Versions ▾   Approvals ▾   Signatures ▾   │             │
│              │  │  [Open] [Download] [Compare] [Revoke]      │             │
│              │  └───────────────────────────────────────────┘             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

- File-explorer left rail with smart folders.
- Approval queue surfaces in the top bar with a numbered badge.
- Version compare opens a side-by-side diff view.

### 16.5.5 Chat

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀  CHANNELS                    │  # incident-eq-1234         👥 24    [⋯] │
│ ───────────────                │  ─────────────────────────────────────── │
│ ⭐ Pinned                       │                                          │
│   # general                    │   Yesterday                              │
│ # incident-eq-1234   ●  3      │   ─────                                  │
│ # incident-fl-0980             │   A. Karimov 14:02                       │
│ # ops-shift-night    ●         │     SAR team 4 dispatched. ETA 12m.      │
│ ─── DIRECT ──────              │                                          │
│ ● Asyl R.                      │   B. Saidov 14:03                        │
│   Shavkat I.   ● 1             │     Roger. Setting up shelter at         │
│ ─── Agencies ─                 │     gymnasium. Need fuel.                │
│   #moh-liaison                 │                                          │
│   #police-liaison              │   ⚠ SYSTEM 14:05                         │
│                                │     Incident escalated to CRITICAL       │
│                                │                                          │
│                                │   📎 sitrep_01.pdf                       │
│                                │                                          │
│                                │   ━━ A. Karimov is typing ━━             │
│                                │  ┌──────────────────────────────────┐   │
│                                │  │ Type a message...     📎 ⊕ 🎙 ⏎  │   │
│                                │  └──────────────────────────────────┘   │
└────────────────────────────────┴──────────────────────────────────────────┘
```

- Channels left, conversation right; right panel optional for thread.
- Presence dots, unread counts, mentions highlighted.
- System messages distinct (no avatar, narrow row, muted color).
- Slash commands: `/escalate`, `/task`, `/call`, `/sitrep`, `/assign @user`.
- Files dropped inline, scanned, then become previewable.

### 16.5.6 Admin Panel

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Admin                                                                      │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ Tenants      │  USERS                                                     │
│ Users    ◀   │  ─────                                                     │
│ Roles        │  Search...        Filter: tenant=KChS-Dushanbe    [+ New]  │
│ Policies     │                                                            │
│ Integrations │  Name           Email           Roles      Status   MFA    │
│ Audit log    │  A. Karimov     a.k@kchs.tj    IC, Lead   Active   ✓     │
│              │  B. Saidov      b.s@kchs.tj    Operator   Active   ✓     │
│              │  ...                                                       │
│              │                                                            │
│              │  Right panel when row selected:                            │
│              │  ┌────────────────────────────────────────────────┐       │
│              │  │ A. Karimov                                      │       │
│              │  │ a.karimov@kchs.tj · +992...                     │       │
│              │  │ Tenant: KChS-Dushanbe · Clearance: 3            │       │
│              │  │ Roles: incident_commander, shift_lead           │       │
│              │  │ ─── Sessions (2 active) ─── Devices ───         │       │
│              │  │ ─── Recent activity ───                         │       │
│              │  │ [Reset MFA] [Disable] [Edit roles]              │       │
│              │  └────────────────────────────────────────────────┘       │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

- Roles editor: matrix of permissions (rows) × roles (columns), with inline diff vs. saved.
- Policy editor: visual builder + JSON tab for power users.
- Audit log: streaming table with rich filters (actor, action, resource, time range), CSV export.

## 16.6 UX Principles (Strict)

1. **Zero confusion.** Every element has a single, obvious purpose. No "What does this button do?" moments. Tooltips on every icon-only button.
2. **Minimal clicks.** Primary actions are 1 click; destructive actions are 2 clicks (button + confirmation).
3. **Real-time feedback.** Optimistic UI on writes; rollback with toast on failure. Loading states are skeletons, never spinners on full pages.
4. **No overloaded screens.** If a screen needs to explain itself with a tour, redesign it.
5. **Progressive disclosure.** Complex objects (incidents, documents) show summary first; deep details one click away.
6. **Accessibility, not as an afterthought.**
   - Full keyboard navigation; visible focus rings (`outline: 2px var(--primary); outline-offset: 2px`).
   - Tab order matches visual order.
   - All interactive elements ≥ 32×32 hit area.
   - Dynamic content announces via aria-live=polite (assertive only for CRITICAL).
   - Color is never the only signal: status icons + text + color.
7. **Error recovery.** Every error tells the user what happened, why, and what to do. Trace ID always copyable.
8. **Empty states sell the feature.** Each empty state has an illustration (line icon, mono), a sentence, and a primary action.
9. **Internationalization.** ru, tg, en at launch. RTL ready (no hard-coded text alignment). Date/time always relative + absolute on hover.
10. **Density without cruelty.** Compact mode is default but text never goes below 13px and never below 4.5:1 contrast.

## 16.7 Cmd-K (Command Palette)

Cmd-K is the universal entry point. It searches across:
- Incidents (by code, title)
- Tasks
- Documents
- People
- Channels
- Map locations (geocoded)
- Commands ("create incident", "go to dashboard", "switch to dark mode")

Backed by OpenSearch with prefix and trigram fallback. Each result has a type icon and a context line. Up/down to navigate, Enter to act, Tab to peek into right panel without leaving palette.

## 16.8 Notifications UI

- Bell icon in top bar with unread count.
- Notification center as a slide-over from the right.
- Per-rule muting; CRITICAL cannot be muted.
- In-page toasts only for actions the user just took (success/error). System events go to the bell, not as toasts — toasts are for the user's own actions.

---

# 17. IMPLEMENTATION ROADMAP

## 17.1 Team Structure (target)

| Squad | Members | Owns |
|---|---|---|
| **Platform** | 1 staff eng, 2 backend, 1 SRE | infra, IAM, audit, observability |
| **Incident Core** | 1 tech lead, 3 backend, 2 frontend | Incident, Task, Document |
| **Realtime & Comm** | 1 lead, 2 backend, 1 frontend | Realtime gateway, Chat, mediasoup |
| **GIS** | 1 lead, 1 backend, 1 frontend, 1 GIS specialist | GIS module + map UI |
| **Design Systems** | 1 lead designer, 1 frontend | shadcn/ui extension, tokens, Storybook |
| **Product Design** | 1 principal, 2 designers | Screens, flows, research |
| **QA** | 1 lead, 2 SDET | E2E, contract tests, perf |
| **Security** | 1 lead | threat modeling, pen test, vault, policies |

≈ 25 people. Smaller is fine but not below 12 for the core launch.

## 17.2 Phases

### Phase 0 — Foundations (Weeks 1–4)

**Deliverables**
- Repo, monorepo tooling (pnpm + nx), CI skeleton.
- Docker compose dev stack (postgres+postgis, redis, nats, minio, opensearch).
- NestJS app shell with logging, config, health probes, OpenTelemetry.
- Next.js shell with shadcn/ui, design tokens, dark/light themes, sidebar+topbar layout.
- IAM v0: users, roles, sessions, login, MFA (TOTP).
- ADRs (Architecture Decision Records) for the fixed stack.

**Risks:** none material. **Dependencies:** none.

### Phase 1 — Incident Core MVP (Weeks 5–12)

**Deliverables**
- Incident domain (CRUD, state machine, timeline, participants).
- Task domain (CRUD, board UI, SLA timers).
- Document domain (basic versioning, no approvals yet).
- Realtime gateway (Socket.IO + Redis adapter), incident scope.
- Outbox + NATS basic events.
- Incident page UI (3-pane), Task board UI, Dashboard v1.
- E2E tests covering scenarios A and B.

**Risks:** state-machine sprawl. **Mitigation:** XState modeled in `packages/contracts` and reviewed weekly.
**Dependencies:** Phase 0 complete.

### Phase 2 — Communication & GIS (Weeks 13–20)

**Deliverables**
- Chat (channels, messages, presence, attachments).
- Incident rooms auto-provisioned.
- mediasoup SFU + recording for incidents ≥ HIGH.
- GIS module: layers, features, PostGIS queries, drawing tools.
- Map preview on dashboard, full map page.
- Document approvals + signatures (TOTP first, WebAuthn fast-follow).

**Risks:** mediasoup ops complexity. **Mitigation:** dedicated SRE pairing with comm squad; load test from week 16.
**Dependencies:** Phase 1 deployed to staging.

### Phase 3 — IAM Hardening, ABAC, Admin Panel (Weeks 21–26)

**Deliverables**
- ABAC policy engine, PDP, Redis cache.
- Admin panel: tenants, users, roles, policies, integrations, audit log.
- Break-glass flow with co-sign + auto-expiry.
- WebAuthn for `platform_admin` and break-glass.
- Audit module with HMAC chain and signed export.

**Risks:** policy authoring UX. **Mitigation:** policies authored by 2 real ops users in week 22; iterate.

### Phase 4 — Analytics & Reporting (Weeks 27–32)

**Deliverables**
- Analytics ETL consumer.
- Star schema and materialized views.
- Operational/Tactical/Strategic dashboards.
- Post-incident report auto-generation.
- Read-only SQL workbench (analyst persona only).

**Risks:** dashboards bloat. **Mitigation:** every dashboard must answer one question stated in plain language.

### Phase 5 — Resilience, DR, Hardening, Pilot (Weeks 33–40)

**Deliverables**
- Chaos engineering game days, monthly cadence.
- DR drill with failover ≤ 15 min validated.
- Pen test, fix backlog, retest.
- WCAG 2.2 AA audit and fixes.
- Performance test against NFR targets.
- Pilot with one regional KChS office, 50 users, 4-week soak.

**Risks:** pilot reveals UX gaps. **Mitigation:** dedicated UX research stream, weekly playback.

### Phase 6 — National Rollout (Weeks 41–52)

**Deliverables**
- Gradual rollout to remaining regions (2/week).
- Training material, in-app onboarding tours.
- Operator certification.
- Production runbooks finalized.
- 24/7 on-call established.

**Exit criteria for v1.0:** 99.95% achieved 60 days running; 0 critical security findings open; pilot NPS ≥ 50; all 4 scenarios validated end-to-end in production.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Tenant** | A regional KChS office or partner agency with isolated data. |
| **Incident** | The central operational object — anything from a drill to a national disaster. |
| **Sitrep** | Situation Report — a timestamped, geo-tagged status update from the field. |
| **IC** | Incident Commander. |
| **PDP** | Policy Decision Point — evaluates ABAC policies. |
| **SFU** | Selective Forwarding Unit — mediasoup, for video/voice routing. |
| **DLQ** | Dead-Letter Queue. |
| **RLS** | Row-Level Security (PostgreSQL). |
| **WORM** | Write-Once-Read-Many (object lock for audit-grade storage). |

---

## Appendix B — Decision Log (initial)

| # | Decision | Why |
|---|---|---|
| ADR-001 | NestJS modular monolith first, microservices later | Speed, debuggability, smaller team |
| ADR-002 | NATS JetStream over Kafka | Lower ops overhead, sufficient throughput, JetStream durability |
| ADR-003 | mediasoup over Janus/Jitsi | Library, not server; embeds in our Node stack; full control |
| ADR-004 | shadcn/ui over MUI/Ant | Owned, themable, no runtime dependency, fits our design language |
| ADR-005 | Cursor pagination only | Stable under inserts, performant on large tables |
| ADR-006 | Dark theme as ops default | Command-room reality |
| ADR-007 | OKLCH for color tokens | Perceptual uniformity, future-proof |
| ADR-008 | Outbox pattern, no dual writes | Correctness over convenience |
| ADR-009 | RLS for tenant isolation | Defense in depth even if app code has a bug |
| ADR-010 | OpenTelemetry, vendor-neutral | Sovereign deployment, no SaaS lock-in |

---

**End of BIG_PLAN.md — v1.0**
*This document is the source of truth. All PRs must reference the section they implement or amend. Amendments require an ADR.*
