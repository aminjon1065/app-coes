# Incident Module -- Core Operational Domain

## 1. Purpose

The Incident module is the central operational object of the entire Sentinel disaster management platform. Every other operational module -- tasks, documents, chat, GIS overlays, notifications, analytics -- revolves around incidents.

An incident represents any event that requires coordinated response: earthquake, flood, fire, wildfire, industrial accident, CBRN event, mass gathering, medical emergency, transport incident, or drill.

### Ownership Boundaries

Incident **owns**:

- The full incident lifecycle (draft through archived)
- Incident classification, severity, and status state machine
- Incident participants and their roles within the incident
- Timeline entries (the authoritative audit trail of everything that happened)
- Situation reports (field-submitted assessment data)
- Resource tracking (vehicles, teams, equipment, supplies deployed to the incident)
- Geofence (area of operations polygon) and epicenter (point of origin)
- Incident code generation and uniqueness
- Parent/child incident hierarchy (multi-region coordination)

Incident **does not own**:

- Tasks (owned by the Task module; linked via `incident_id` FK)
- Documents and attachments (owned by the Document module; linked via `incident_id` FK)
- Chat channels (owned by the Chat module; auto-created/archived via events)
- GIS features and map layers (owned by the GIS module; incident provides geofence/epicenter)
- Notifications (owned by the Notification module; incident emits events that Notification consumes)
- User identity and permissions (owned by IAM; incident queries IAM for authorization)

---

## 2. Domain Model

### Aggregates

#### Incident (Aggregate Root)

| Column         | Type                       | Notes                                                                             |
| -------------- | -------------------------- | --------------------------------------------------------------------------------- |
| id             | uuid (v7)                  | PK                                                                                |
| tenant_id      | uuid                       | FK -> iam.tenants, NOT NULL                                                       |
| code           | text                       | UNIQUE globally, immutable, format: `{CATEGORY_CODE}-{YEAR}-{MONTH}-{SEQUENCE}`  |
| title          | text                       | 3-200 chars, NOT NULL                                                             |
| description    | text                       | Max 5000 chars, nullable                                                          |
| category       | text                       | CHECK (category IN enum list), NOT NULL                                           |
| severity       | smallint                   | CHECK (severity BETWEEN 1 AND 4), NOT NULL                                        |
| status         | text                       | CHECK (status IN state list), NOT NULL, default 'draft'                           |
| classification | smallint                   | CHECK (classification BETWEEN 1 AND 4), default 1                                 |
| commander_id   | uuid                       | FK -> iam.users, nullable (null only in draft)                                    |
| geofence       | geography(Polygon, 4326)   | Nullable, max 1000 vertices                                                       |
| epicenter      | geography(Point, 4326)     | Nullable                                                                          |
| opened_at      | timestamptz                | Set when status transitions from draft to open                                    |
| closed_at      | timestamptz                | Set when status transitions to closed, cleared on reopen                           |
| parent_id      | uuid                       | FK -> incident.incidents (self-ref), nullable, max depth 3                        |
| metadata       | jsonb                      | Extensible key-value store for domain-specific data                               |
| created_by     | uuid                       | FK -> iam.users, NOT NULL, immutable                                              |
| created_at     | timestamptz                | Default now()                                                                     |
| updated_at     | timestamptz                | Default now(), trigger-maintained                                                 |

**Category codes for incident code generation:**

| Category       | Code |
| -------------- | ---- |
| earthquake     | EQ   |
| flood          | FL   |
| fire           | FR   |
| wildfire       | WF   |
| industrial     | IN   |
| cbrn           | CB   |
| mass_gathering | MG   |
| medical        | MD   |
| transport      | TR   |
| other          | OT   |

**Example incident code:** `EQ-2026-04-0012` (earthquake, April 2026, sequence 12)

#### IncidentParticipant (Entity)

| Column           | Type        | Notes                                                                 |
| ---------------- | ----------- | --------------------------------------------------------------------- |
| incident_id      | uuid        | FK -> incident.incidents, part of composite PK                        |
| user_id          | uuid        | FK -> iam.users, part of composite PK                                 |
| role_in_incident | text        | CHECK (role_in_incident IN ('commander','deputy','liaison','observer','responder')) |
| joined_at        | timestamptz | Default now()                                                         |
| left_at          | timestamptz | Nullable, set when participant is removed                             |

#### IncidentTimelineEntry (Entity, Partitioned)

| Column      | Type        | Notes                                                                                      |
| ----------- | ----------- | ------------------------------------------------------------------------------------------ |
| id          | uuid (v7)   | PK                                                                                         |
| incident_id | uuid        | FK -> incident.incidents, NOT NULL                                                         |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL (denormalized for RLS)                                         |
| ts          | timestamptz | NOT NULL, partition key                                                                    |
| kind        | text        | CHECK (kind IN enum list), NOT NULL                                                        |
| actor_id    | uuid        | FK -> iam.users, NOT NULL                                                                  |
| payload     | jsonb       | Contains before/after for changes, sitrep_id for sitreps, reason for transitions, etc.     |

**Timeline entry kinds:**

`status_change`, `severity_change`, `assignment`, `sitrep`, `document`, `note`, `participant_joined`, `participant_left`, `geofence_update`, `epicenter_update`, `escalation`, `classification_change`, `commander_assigned`, `resource_deployed`, `resource_returned`

#### SituationReport (Entity)

| Column      | Type                     | Notes                                              |
| ----------- | ------------------------ | -------------------------------------------------- |
| id          | uuid (v7)                | PK                                                 |
| incident_id | uuid                     | FK -> incident.incidents, NOT NULL                  |
| tenant_id   | uuid                     | FK -> iam.tenants, NOT NULL (denormalized for RLS)  |
| reporter_id | uuid                     | FK -> iam.users, NOT NULL                           |
| location    | geography(Point, 4326)   | Nullable                                            |
| severity    | smallint                 | CHECK (severity BETWEEN 1 AND 4), nullable          |
| text        | text                     | NOT NULL, max 10000 chars                           |
| attachments | uuid[]                   | References file.files, default '{}'                 |
| reported_at | timestamptz              | Default now()                                       |

#### IncidentResource (Entity)

| Column        | Type                     | Notes                                                           |
| ------------- | ------------------------ | --------------------------------------------------------------- |
| id            | uuid (v7)                | PK                                                              |
| incident_id   | uuid                     | FK -> incident.incidents, NOT NULL                               |
| tenant_id     | uuid                     | FK -> iam.tenants, NOT NULL (denormalized for RLS)               |
| resource_type | text                     | CHECK (resource_type IN ('vehicle','team','equipment','supply')) |
| resource_id   | text                     | External resource identifier, NOT NULL                           |
| name          | text                     | Human-readable label, NOT NULL                                   |
| status        | text                     | CHECK (status IN ('deployed','en_route','returned'))             |
| deployed_at   | timestamptz              | Default now()                                                    |
| returned_at   | timestamptz              | Nullable, set when status changes to returned                    |
| location      | geography(Point, 4326)   | Nullable, last known position                                    |

### Value Objects

**Severity**

```typescript
export enum Severity {
  LOW      = 1,
  MODERATE = 2,
  HIGH     = 3,
  CRITICAL = 4,
}
```

**Status**

```typescript
export enum IncidentStatus {
  DRAFT     = 'draft',
  OPEN      = 'open',
  ESCALATED = 'escalated',
  CONTAINED = 'contained',
  CLOSED    = 'closed',
  ARCHIVED  = 'archived',
}
```

**Category**

```typescript
export enum IncidentCategory {
  EARTHQUAKE     = 'earthquake',
  FLOOD          = 'flood',
  FIRE           = 'fire',
  WILDFIRE       = 'wildfire',
  INDUSTRIAL     = 'industrial',
  CBRN           = 'cbrn',
  MASS_GATHERING = 'mass_gathering',
  MEDICAL        = 'medical',
  TRANSPORT      = 'transport',
  OTHER          = 'other',
}
```

**Classification**

```typescript
export enum Classification {
  PUBLIC       = 1,  // visible to all authenticated users
  INTERNAL     = 2,  // requires clearance >= INTERNAL
  CONFIDENTIAL = 3,  // requires clearance >= CONFIDENTIAL
  SECRET       = 4,  // requires clearance >= SECRET
}
```

**IncidentCode (Value Object)**

```typescript
export class IncidentCode {
  private constructor(public readonly value: string) {}

  /**
   * Format: {CATEGORY_CODE}-{YYYY}-{MM}-{SEQUENCE}
   * Sequence is zero-padded to 4 digits, auto-increments per tenant per month.
   * Immutable once created — never changes even if category is updated.
   */
  static generate(
    category: IncidentCategory,
    year: number,
    month: number,
    sequence: number,
  ): IncidentCode {
    const codeMap: Record<IncidentCategory, string> = {
      earthquake: 'EQ', flood: 'FL', fire: 'FR', wildfire: 'WF',
      industrial: 'IN', cbrn: 'CB', mass_gathering: 'MG',
      medical: 'MD', transport: 'TR', other: 'OT',
    };
    const code = `${codeMap[category]}-${year}-${String(month).padStart(2, '0')}-${String(sequence).padStart(4, '0')}`;
    return new IncidentCode(code);
  }

  toString(): string {
    return this.value;
  }
}
```

### State Machine

Every valid transition, its preconditions, and the required role:

```
 ┌───────┐
 │ draft │
 └──┬────┘
    │ open (requires: title, category, severity)
    ▼
 ┌──────┐ ◄──── de-escalate (shift_lead+)
 │ open │ ◄──── re-open from contained (IC)
 └─┬──┬─┘ ◄──── re-open from closed (shift_lead+ ; requires reason + audit)
   │  │
   │  └──── escalate (IC or shift_lead+ ; requires reason)
   │         ▼
   │      ┌───────────┐
   │      │ escalated │
   │      └──┬──┬─────┘
   │         │  │
   │         │  └──── de-escalate → open (shift_lead+)
   │         │
   │         └──── contain (IC ; requires reason)
   │                │
   └──── contain ───┘
   (IC ; requires reason)
          ▼
       ┌───────────┐
       │ contained │
       └──┬──┬─────┘
          │  │
          │  └──── re-open → open (requires reason)
          │
          └──── close (IC ; requires ALL tasks done/cancelled + resolution_summary)
                 ▼
              ┌────────┐
              │ closed │
              └──┬──┬──┘
                 │  │
                 │  └──── re-open → open (shift_lead+ ; requires reason + audit)
                 │
                 └──── archive (tenant_admin+ ; after retention period or manual)
                        ▼
                     ┌──────────┐
                     │ archived │
                     └──────────┘
```

**Transition table (exhaustive):**

| From      | To        | Transition Code | Required Role     | Preconditions                                          |
| --------- | --------- | --------------- | ----------------- | ------------------------------------------------------ |
| draft     | open      | open            | creator or above  | title, category, severity must be set                  |
| open      | escalated | escalate        | IC or shift_lead+ | reason required                                        |
| open      | contained | contain         | IC                | reason required                                        |
| escalated | contained | contain         | IC                | reason required                                        |
| escalated | open      | de_escalate     | shift_lead+       | reason required                                        |
| contained | closed    | close           | IC                | ALL linked tasks done/cancelled; resolution_summary    |
| contained | open      | reopen          | IC or shift_lead+ | reason required                                        |
| closed    | archived  | archive         | tenant_admin+     | retention period elapsed or manual override             |
| closed    | open      | reopen          | shift_lead+       | reason required; creates audit entry                   |

**Invalid transitions (explicitly rejected):**

- `draft -> closed` (must go through open/contained first)
- `open -> archived` (must close first)
- `any -> draft` (draft is initial-only; no going back)
- `archived -> any` (terminal state)

**Every transition MUST:**

1. Create a `TimelineEntry` with kind `status_change` and payload containing `{ before, after, reason }`
2. Emit `incident.status_changed.v1` event
3. Update `updated_at` timestamp
4. If transitioning to `open` from `draft`: set `opened_at`
5. If transitioning to `closed`: set `closed_at`
6. If transitioning from `closed` to `open` (reopen): clear `closed_at`

```typescript
// Domain layer enforcement — not in the application service
export class Incident {
  transitionTo(target: IncidentStatus, actor: Actor, params: TransitionParams): DomainEvent[] {
    const allowed = this.getAllowedTransitions(actor);
    const transition = allowed.find(t => t.to === target);
    if (!transition) {
      throw new InvalidTransitionError(this.status, target);
    }
    transition.validate(params); // throws if preconditions not met

    const before = this.status;
    this.status = target;
    this.updatedAt = new Date();

    if (target === IncidentStatus.OPEN && before === IncidentStatus.DRAFT) {
      this.openedAt = new Date();
    }
    if (target === IncidentStatus.CLOSED) {
      this.closedAt = new Date();
    }
    if (target === IncidentStatus.OPEN && before === IncidentStatus.CLOSED) {
      this.closedAt = null;
    }

    const timelineEntry = IncidentTimelineEntry.create({
      incidentId: this.id,
      tenantId: this.tenantId,
      kind: 'status_change',
      actorId: actor.userId,
      payload: { before, after: target, reason: params.reason },
    });

    return [
      new IncidentStatusChangedEvent({
        incidentId: this.id,
        tenantId: this.tenantId,
        before,
        after: target,
        actorId: actor.userId,
        reason: params.reason,
      }),
    ];
  }
}
```

---

## 3. Business Rules

### Invariants

1. **Task completion gate**: An incident CANNOT transition to `closed` while any linked task has status `TODO`, `IN_PROGRESS`, or `BLOCKED`. This is enforced by querying the task module's cached count at close time, inside the same transaction with a `FOR UPDATE` lock on the incident row.

2. **Severity change authorization**: Severity can only be RAISED by `incident_commander` or above. LOWERING severity requires `shift_lead` or above. This is enforced in the domain entity, not the application service.

3. **Automatic timeline entries**: Every state transition, severity change, participant change, geofence update, and commander assignment produces a `TimelineEntry` automatically. This is enforced at the domain layer -- the aggregate root produces timeline entries as part of its mutation methods.

4. **Single commander**: An incident always has exactly ONE primary commander (`commander_id`). The `deputy` role is a participant role and does not replace the commander. When the commander is reassigned, the old commander remains as a participant with role `observer` unless explicitly removed.

5. **Immutable incident codes**: Once generated during incident creation, the `code` field never changes, even if the category is later updated.

6. **Classification ratchet**: Classification can only be raised, never lowered. If a lower classification is needed, a new incident must be created. This prevents accidental exposure of sensitive information.

7. **Hierarchy depth limit**: `parent_id` creates a tree structure with a maximum depth of 3 levels (national -> regional -> local). Attempts to exceed this depth are rejected with `INCIDENT_DEPTH_EXCEEDED`.

8. **Geofence update triggers**: Any geofence update emits `incident.geofence_updated.v1`, which triggers recalculation of affected GIS features by the GIS module.

9. **Draft visibility**: An incident in `draft` status is only visible to its `created_by` user and users with `shift_lead` role or above. RLS policy enforces this at the database level.

10. **Close side effects**: Closing an incident emits `incident.closed.v1`, which the Chat module consumes to archive the associated chat room.

11. **Critical severity notification**: Setting severity to `CRITICAL` (4) emits `incident.severity_changed.v1` with `severity: 4`, which the Notification module consumes to send mandatory alerts to all `shift_lead` and `tenant_admin` users in the tenant.

### Constraints

| Constraint                          | Enforcement        |
| ----------------------------------- | ------------------ |
| `code` globally unique              | UNIQUE index       |
| `(incident_id, user_id)` unique     | Composite PK       |
| `severity` between 1 and 4          | CHECK constraint   |
| `classification` between 1 and 4    | CHECK constraint   |
| Status follows state machine        | Domain layer       |
| `title` 3-200 chars                 | CHECK + app layer  |
| `description` max 5000 chars        | CHECK + app layer  |
| `category` in allowed enum          | CHECK constraint   |
| `geofence` max 1000 vertices        | App layer          |
| `epicenter` valid WGS84 point       | PostGIS            |
| `geofence` valid WGS84 polygon      | PostGIS            |

### Validation Rules

```typescript
// Enforced at both DTO (class-validator) and domain entity level

// Title: 3-200 characters, no leading/trailing whitespace
title: string; // @Length(3, 200) @Trim()

// Description: max 5000 characters
description?: string; // @MaxLength(5000) @IsOptional()

// Category: must be a valid enum value
category: IncidentCategory; // @IsEnum(IncidentCategory)

// Severity: 1-4
severity: Severity; // @IsInt() @Min(1) @Max(4)

// Epicenter: valid latitude (-90 to 90) and longitude (-180 to 180)
epicenter?: GeoPointDto; // lat: @Min(-90) @Max(90), lng: @Min(-180) @Max(180)

// Geofence: valid polygon with at most 1000 vertices
geofence?: GeoPolygonDto; // coordinates: @ArrayMaxSize(1000)
```

---

## 4. Use Cases

### Commands

#### CreateIncident

**Actor:** duty_operator or above
**Input:** title, category, severity, description?, classification?, epicenter?, geofence?, metadata?
**Flow:**

1. Validate all input fields
2. Generate incident code: query `incident.code_sequences` for next sequence number in current tenant/month
3. Set `status = draft` (or `open` if all required fields for open are present and actor opts in)
4. Set `created_by = actor.userId`
5. If status set to `open`, set `opened_at = now()`
6. Persist incident
7. Create initial `TimelineEntry` with kind `status_change`, payload `{ after: 'draft' }`
8. Publish outbox message: `incident.created.v1`
9. Return created incident

**Idempotency:** Supports `Idempotency-Key` header. If a duplicate key is received, return the previously created incident without side effects.

#### UpdateIncident

**Actor:** IC, deputy, or shift_lead+
**Input:** title?, description?, category?, metadata?
**Flow:**

1. Load incident, verify not `closed` or `archived`
2. Validate changed fields
3. Apply changes (category change does NOT change the incident code)
4. Create `TimelineEntry` with kind `note`, payload `{ changes: { field: { before, after } } }`
5. Publish `incident.updated.v1`

#### TransitionStatus

**Actor:** varies by transition (see state machine table)
**Input:** transition code, reason, resolutionSummary? (for close)
**Flow:**

1. Load incident with `FOR UPDATE` lock
2. Call `incident.transitionTo(target, actor, params)` -- domain method validates transition, preconditions, and permissions
3. For `close` transition: query task module for open task count; if > 0, throw `INCIDENT_OPEN_TASKS_EXIST`; if task module unavailable, throw `UNABLE_TO_VERIFY_TASK_STATUS`
4. Persist updated incident and timeline entry
5. Publish `incident.status_changed.v1` via outbox

#### ChangeSeverity

**Actor:** IC (raise), shift_lead+ (lower)
**Input:** severity (1-4), reason
**Flow:**

1. Load incident, verify not `closed` or `archived`
2. Determine direction: raising or lowering
3. Validate actor has permission for the direction
4. Update severity
5. Create `TimelineEntry` with kind `severity_change`, payload `{ before, after, reason }`
6. Publish `incident.severity_changed.v1`
7. If new severity is `CRITICAL`, the event payload triggers Notification module

#### AssignCommander

**Actor:** shift_lead+
**Input:** userId
**Flow:**

1. Load incident
2. Verify target user exists and has IC capability (query IAM)
3. If current commander exists, change their participant role to `observer`
4. Set `commander_id = userId`
5. Add user as participant with role `commander` if not already a participant
6. Create `TimelineEntry` with kind `commander_assigned`
7. Publish `incident.commander_assigned.v1`

#### AddParticipant

**Actor:** IC, deputy, or shift_lead+
**Input:** userId, role (deputy, liaison, observer, responder)
**Flow:**

1. Load incident
2. Verify user not already an active participant (where `left_at IS NULL`)
3. Cannot add with role `commander` (use AssignCommander instead)
4. Insert participant row
5. Create `TimelineEntry` with kind `participant_joined`
6. Publish `incident.participant_added.v1`

#### RemoveParticipant

**Actor:** IC or shift_lead+
**Input:** userId
**Flow:**

1. Load incident
2. Verify target is not the current commander (must reassign first)
3. Set `left_at = now()` on participant row (soft removal)
4. Create `TimelineEntry` with kind `participant_left`
5. Publish `incident.participant_removed.v1`

#### SubmitSitrep

**Actor:** field_responder+, must be active participant
**Input:** text, location?, severity?, attachments?
**Flow:**

1. Verify incident status is `open` or `escalated`
2. Verify actor is an active participant
3. Create `SituationReport` row
4. Create `TimelineEntry` with kind `sitrep`, payload `{ sitrep_id }`
5. Publish `incident.sitrep.submitted.v1`

#### UpdateGeofence

**Actor:** IC or shift_lead+
**Input:** GeoPolygonDto (coordinates array)
**Flow:**

1. Load incident, verify not `closed` or `archived`
2. Validate polygon: max 1000 vertices, valid WGS84 coordinates, valid geometry (no self-intersection)
3. Update geofence column
4. Create `TimelineEntry` with kind `geofence_update`
5. Publish `incident.geofence_updated.v1` (consumed by GIS module for feature recalculation)

#### UpdateEpicenter

**Actor:** IC or shift_lead+
**Input:** GeoPointDto (lat, lng)
**Flow:**

1. Load incident, verify not `closed` or `archived`
2. Validate point: valid WGS84 coordinates
3. Update epicenter column
4. Create `TimelineEntry` with kind `epicenter_update`
5. Publish `incident.epicenter_updated.v1`

#### LinkChildIncident

**Actor:** shift_lead+
**Input:** childIncidentId, parentIncidentId
**Flow:**

1. Load both incidents, verify same tenant
2. Calculate depth of parent: walk up `parent_id` chain; if parent is already at depth 2 (0-indexed), reject with `INCIDENT_DEPTH_EXCEEDED`
3. Set `parent_id` on child incident
4. Create `TimelineEntry` on both parent and child
5. Publish `incident.child_linked.v1`

#### CloseIncident

Alias for `TransitionStatus` with `transition = 'close'`. Requires `resolutionSummary`.

#### ReopenIncident

Alias for `TransitionStatus` with `transition = 'reopen'`. Requires reason and creates audit entry.

### Queries

#### ListIncidents

**Actor:** any authenticated user (filtered by classification vs clearance)
**Parameters:** cursor, limit (max 100, default 25), filters (status, severity, category, commander_id, date range, bbox), sort
**Implementation:**

- RLS automatically filters by `tenant_id`
- Classification filter: `classification <= user.clearance` (ABAC)
- Draft visibility: `status != 'draft' OR created_by = :userId OR :userRole >= 'shift_lead'`
- BBox filter: `ST_Intersects(geofence, ST_MakeEnvelope(:west, :south, :east, :north, 4326))`
- Cursor-based pagination using `(opened_at, id)` composite cursor
- Redis cache for common queries (invalidated on incident change events)

#### GetIncident

**Actor:** any authenticated user (classification check)
**Returns:** Full incident DTO including:
- All incident fields
- Participant list (active only, i.e., `left_at IS NULL`)
- Latest 10 timeline entries
- Stats: `{ taskCount, openTaskCount, sitrepCount, participantCount, resourceCount }`

#### GetTimeline

**Actor:** same as incident.read
**Parameters:** incident_id, cursor, limit (max 100, default 50)
**Implementation:** Cursor-based pagination on `(ts, id)` descending. Reads from partitioned table.

#### ListSitreps

**Actor:** same as incident.read
**Parameters:** incident_id, cursor, limit (max 50, default 20)

#### GetAvailableTransitions

**Actor:** any authenticated user with incident.read
**Returns:** Array of transitions valid for the current state AND the requesting user's role.

```json
{
  "data": [
    { "code": "escalate", "label": "Escalate Incident", "requires": ["reason"] },
    { "code": "contain", "label": "Mark as Contained", "requires": ["reason"] }
  ]
}
```

#### GetIncidentStats

**Actor:** shift_lead+
**Returns:** Aggregated dashboard statistics.
**Implementation:** Redis-cached, refreshed every 30 seconds by a background job that queries:

```sql
SELECT
  count(*) FILTER (WHERE status IN ('open','escalated')) AS open_count,
  count(*) FILTER (WHERE severity = 1) AS sev_low,
  count(*) FILTER (WHERE severity = 2) AS sev_moderate,
  count(*) FILTER (WHERE severity = 3) AS sev_high,
  count(*) FILTER (WHERE severity = 4) AS sev_critical,
  count(*) FILTER (WHERE category = 'earthquake') AS cat_earthquake,
  -- ... per category
  avg(EXTRACT(EPOCH FROM (closed_at - opened_at)))
    FILTER (WHERE closed_at IS NOT NULL AND opened_at IS NOT NULL) AS avg_response_time_sec
FROM incident.incidents
WHERE tenant_id = :tenantId
  AND status NOT IN ('archived');
```

#### SearchIncidents

**Actor:** any authenticated user (classification-filtered)
**Implementation:** Full-text search via OpenSearch index on `title`, `description`, `code`. Incident module publishes change events; a search indexer consumer keeps the index in sync.

#### GetNearbyIncidents

**Actor:** any authenticated user (classification-filtered)
**Parameters:** lat, lng, radiusMeters (max 500000)
**Implementation:**

```sql
SELECT * FROM incident.incidents
WHERE ST_DWithin(epicenter, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)
  AND tenant_id = :tenantId
  AND status NOT IN ('archived', 'closed')
ORDER BY epicenter <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
LIMIT :limit;
```

#### GetIncidentTree

**Actor:** any authenticated user (classification-filtered)
**Parameters:** incident_id
**Returns:** The parent incident (if any) and all child incidents, forming the tree.
**Implementation:** Recursive CTE:

```sql
WITH RECURSIVE tree AS (
  -- Find root
  SELECT id, parent_id, title, status, severity, 0 AS depth
  FROM incident.incidents
  WHERE id = :rootId AND tenant_id = :tenantId
  UNION ALL
  SELECT i.id, i.parent_id, i.title, i.status, i.severity, t.depth + 1
  FROM incident.incidents i
  JOIN tree t ON i.parent_id = t.id
  WHERE t.depth < 3
)
SELECT * FROM tree ORDER BY depth, created_at;
```

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max, Length,
  MaxLength, IsUUID, ValidateNested, IsArray, ArrayMaxSize,
  IsNumber, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Geo DTOs ──────────────────────────────────────────────

export class GeoPointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class GeoPolygonDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  coordinates: GeoPointDto[];
}

// ── Command DTOs ──────────────────────────────────────────

export class CreateIncidentDto {
  @IsString()
  @Length(3, 200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(IncidentCategory)
  category: IncidentCategory;

  @IsInt()
  @Min(1)
  @Max(4)
  severity: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  classification?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  epicenter?: GeoPointDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPolygonDto)
  geofence?: GeoPolygonDto;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateIncidentDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(IncidentCategory)
  category?: IncidentCategory;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TransitionStatusDto {
  @IsString()
  @IsEnum(['escalate', 'de_escalate', 'contain', 'close', 'reopen', 'archive', 'open'])
  transition: string;

  @IsString()
  @Length(1, 2000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  resolutionSummary?: string;
}

export class ChangeSeverityDto {
  @IsInt()
  @Min(1)
  @Max(4)
  severity: number;

  @IsString()
  @Length(1, 2000)
  reason: string;
}

export class AssignCommanderDto {
  @IsUUID()
  userId: string;
}

export class AddParticipantDto {
  @IsUUID()
  userId: string;

  @IsEnum(['deputy', 'liaison', 'observer', 'responder'])
  role: string;
}

export class SubmitSitrepDto {
  @IsString()
  @Length(1, 10000)
  text: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  severity?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachments?: string[];
}

// ── Response DTOs ─────────────────────────────────────────

export class IncidentDto {
  id: string;
  tenantId: string;
  code: string;
  title: string;
  description: string | null;
  category: IncidentCategory;
  severity: number;
  status: IncidentStatus;
  classification: number;
  commanderId: string | null;
  epicenter: GeoPointDto | null;
  geofence: GeoPolygonDto | null;
  openedAt: string | null;
  closedAt: string | null;
  parentId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class IncidentDetailDto extends IncidentDto {
  participants: ParticipantDto[];
  latestTimeline: TimelineEntryDto[];
  stats: {
    taskCount: number;
    openTaskCount: number;
    sitrepCount: number;
    participantCount: number;
    resourceCount: number;
  };
}

export class ParticipantDto {
  userId: string;
  roleInIncident: string;
  joinedAt: string;
}

export class TimelineEntryDto {
  id: string;
  kind: string;
  actorId: string;
  ts: string;
  payload: Record<string, unknown>;
}

export class SitrepDto {
  id: string;
  incidentId: string;
  reporterId: string;
  location: GeoPointDto | null;
  severity: number | null;
  text: string;
  attachments: string[];
  reportedAt: string;
}

export class AvailableTransitionDto {
  code: string;
  label: string;
  requires: string[];
}

export class IncidentStatsDto {
  open: number;
  bySeverity: { low: number; moderate: number; high: number; critical: number };
  byCategory: Record<string, number>;
  avgResponseTimeSec: number | null;
}
```

### Endpoints

```
POST   /api/v1/incidents
  Body: CreateIncidentDto
  Headers: Idempotency-Key (optional, UUID)
  Response 201: { data: IncidentDto }
  Errors: 400 (validation), 409 INCIDENT_CODE_CONFLICT

GET    /api/v1/incidents
  Query: cursor, limit (1-100, default 25),
         filter[status], filter[severity], filter[category],
         filter[commander_id], filter[bbox] (west,south,east,north),
         filter[opened_after], filter[opened_before],
         sort (severity_desc | severity_asc | opened_at_desc | opened_at_asc)
  Response 200: { data: IncidentDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/incidents/:id
  Response 200: { data: IncidentDetailDto }
  Errors: 404 INCIDENT_NOT_FOUND, 403 (classification)

PATCH  /api/v1/incidents/:id
  Body: UpdateIncidentDto
  Response 200: { data: IncidentDto }
  Errors: 404, 403, 422 (closed/archived)

POST   /api/v1/incidents/:id/transitions
  Body: TransitionStatusDto
  Response 200: { data: IncidentDto }
  Errors: 422 INCIDENT_INVALID_TRANSITION,
          422 INCIDENT_OPEN_TASKS_EXIST,
          422 INCIDENT_MISSING_RESOLUTION,
          403 (insufficient role for transition)

POST   /api/v1/incidents/:id/severity
  Body: ChangeSeverityDto
  Response 200: { data: IncidentDto }
  Errors: 403 INCIDENT_SEVERITY_ESCALATION_DENIED

POST   /api/v1/incidents/:id/commander
  Body: AssignCommanderDto
  Response 200: { data: IncidentDto }
  Errors: 422 INCIDENT_COMMANDER_REQUIRED (user not found or lacks IC capability)

GET    /api/v1/incidents/:id/participants
  Response 200: { data: ParticipantDto[] }

POST   /api/v1/incidents/:id/participants
  Body: AddParticipantDto
  Response 201: { data: ParticipantDto }

DELETE /api/v1/incidents/:id/participants/:userId
  Response 204
  Errors: 422 (cannot remove commander)

GET    /api/v1/incidents/:id/timeline
  Query: cursor, limit (1-100, default 50)
  Response 200: { data: TimelineEntryDto[], page: { nextCursor, prevCursor, limit, hasMore } }

POST   /api/v1/incidents/:id/sitreps
  Body: SubmitSitrepDto
  Response 201: { data: SitrepDto }
  Errors: 422 (incident not open/escalated), 403 (not a participant)

GET    /api/v1/incidents/:id/sitreps
  Query: cursor, limit (1-50, default 20)
  Response 200: { data: SitrepDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/incidents/:id/transitions/available
  Response 200: { data: AvailableTransitionDto[] }

GET    /api/v1/incidents/stats
  Response 200: { data: IncidentStatsDto }
```

### Error Codes

| Code                                       | HTTP | Description                                                       |
| ------------------------------------------ | ---- | ----------------------------------------------------------------- |
| INCIDENT_NOT_FOUND                         | 404  | Incident does not exist or is not visible to the requesting user  |
| INCIDENT_INVALID_TRANSITION                | 422  | Requested status transition is not valid from the current state   |
| INCIDENT_OPEN_TASKS_EXIST                  | 422  | Cannot close incident; there are tasks in TODO/IN_PROGRESS/BLOCKED|
| INCIDENT_MISSING_RESOLUTION                | 422  | Close transition requires a resolutionSummary                     |
| INCIDENT_SEVERITY_ESCALATION_DENIED        | 403  | Actor lacks permission to change severity in the requested direction |
| INCIDENT_COMMANDER_REQUIRED                | 422  | Target user does not exist or lacks incident commander capability |
| INCIDENT_CODE_CONFLICT                     | 409  | Generated code conflicts (extremely rare race condition, retry)   |
| INCIDENT_CLASSIFICATION_DOWNGRADE_DENIED   | 422  | Classification can only be raised, never lowered                  |
| INCIDENT_DEPTH_EXCEEDED                    | 422  | Parent/child hierarchy would exceed maximum depth of 3            |
| INCIDENT_ALREADY_CLOSED                    | 422  | Incident is already in closed state                               |
| INCIDENT_DRAFT_ONLY_VISIBLE_TO_CREATOR     | 403  | Draft incidents are only visible to their creator and shift_lead+ |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes a standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "incident.created.v1"
  source: string;      // "incident-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### incident.created.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000001",
  "type": "incident.created.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:30:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000099",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "code": "EQ-2026-04-0012",
    "title": "M6.2 Earthquake - Northern Region",
    "category": "earthquake",
    "severity": 4,
    "status": "open",
    "classification": 2,
    "commanderId": null,
    "epicenter": { "lat": 38.7749, "lng": 68.7861 },
    "createdBy": "019526a0-1000-7000-8000-000000000050",
    "openedAt": "2026-04-12T08:30:00.000Z"
  }
}
```

#### incident.updated.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000002",
  "type": "incident.updated.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:45:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000100",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "changes": {
      "title": {
        "before": "M6.2 Earthquake - Northern Region",
        "after": "M6.2 Earthquake - Northern Region (Upgraded)"
      },
      "description": {
        "before": null,
        "after": "Multiple aftershocks reported. Urban area affected."
      }
    },
    "actorId": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### incident.status_changed.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000003",
  "type": "incident.status_changed.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000101",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "before": "open",
    "after": "escalated",
    "reason": "Aftershock M5.1 detected, additional resources needed",
    "actorId": "019526a0-1000-7000-8000-000000000051"
  }
}
```

#### incident.severity_changed.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000004",
  "type": "incident.severity_changed.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:15:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000102",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "before": 3,
    "after": 4,
    "reason": "Collapse of residential block confirmed, mass casualty event",
    "actorId": "019526a0-1000-7000-8000-000000000051"
  }
}
```

#### incident.commander_assigned.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000005",
  "type": "incident.commander_assigned.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:32:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000103",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "previousCommanderId": null,
    "newCommanderId": "019526a0-1000-7000-8000-000000000060",
    "actorId": "019526a0-1000-7000-8000-000000000051"
  }
}
```

#### incident.participant_added.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000006",
  "type": "incident.participant_added.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:35:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000104",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "userId": "019526a0-1000-7000-8000-000000000070",
    "roleInIncident": "responder",
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### incident.participant_removed.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000007",
  "type": "incident.participant_removed.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000105",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "userId": "019526a0-1000-7000-8000-000000000070",
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### incident.sitrep.submitted.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000008",
  "type": "incident.sitrep.submitted.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:20:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000106",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "sitrepId": "019526a0-7c00-7000-8000-000000000080",
    "reporterId": "019526a0-1000-7000-8000-000000000070",
    "severity": 4,
    "location": { "lat": 38.7751, "lng": 68.7865 },
    "hasAttachments": true
  }
}
```

#### incident.geofence_updated.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000009",
  "type": "incident.geofence_updated.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:30:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000107",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "geofence": {
      "type": "Polygon",
      "coordinates": [[[68.78, 38.77], [68.80, 38.77], [68.80, 38.79], [68.78, 38.79], [68.78, 38.77]]]
    },
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### incident.epicenter_updated.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000010",
  "type": "incident.epicenter_updated.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:32:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000108",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "epicenter": { "lat": 38.7749, "lng": 68.7861 },
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### incident.child_linked.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000011",
  "type": "incident.child_linked.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000109",
  "data": {
    "parentIncidentId": "019526a0-7c00-7000-8000-000000000010",
    "childIncidentId": "019526a0-7c00-7000-8000-000000000020",
    "depth": 1,
    "actorId": "019526a0-1000-7000-8000-000000000051"
  }
}
```

#### incident.closed.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000012",
  "type": "incident.closed.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-15T18:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000110",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "code": "EQ-2026-04-0012",
    "resolutionSummary": "All affected buildings inspected. 47 displaced families relocated. Infrastructure repairs underway by municipal authority.",
    "openedAt": "2026-04-12T08:30:00.000Z",
    "closedAt": "2026-04-15T18:00:00.000Z",
    "durationSec": 292200,
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### incident.reopened.v1

```json
{
  "id": "019526a0-7c00-7000-8000-000000000013",
  "type": "incident.reopened.v1",
  "source": "incident-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-16T06:00:00.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000111",
  "data": {
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "reason": "New aftershock M4.8 detected, previously inspected buildings require re-assessment",
    "previousClosedAt": "2026-04-15T18:00:00.000Z",
    "actorId": "019526a0-1000-7000-8000-000000000051"
  }
}
```

### Consumed Events

#### task.completed.v1

**Source:** Task module
**Handler:** Update cached task count for the incident. Decrement `openTaskCount` in Redis cache.

```typescript
@EventHandler('task.completed.v1')
async handleTaskCompleted(event: TaskCompletedEvent): Promise<void> {
  const { incidentId } = event.data;
  if (!incidentId) return;
  await this.cacheService.decrement(`incident:${incidentId}:openTaskCount`);
}
```

#### task.status_changed.v1

**Source:** Task module
**Handler:** Re-evaluate whether the incident can be closed. If a task moves from a terminal state back to an open state, update cached count.

```typescript
@EventHandler('task.status_changed.v1')
async handleTaskStatusChanged(event: TaskStatusChangedEvent): Promise<void> {
  const { incidentId, before, after } = event.data;
  if (!incidentId) return;

  const openStatuses = ['todo', 'in_progress', 'blocked'];
  const wasOpen = openStatuses.includes(before);
  const isOpen = openStatuses.includes(after);

  if (wasOpen && !isOpen) {
    await this.cacheService.decrement(`incident:${incidentId}:openTaskCount`);
  } else if (!wasOpen && isOpen) {
    await this.cacheService.increment(`incident:${incidentId}:openTaskCount`);
  }
}
```

#### document.published.v1

**Source:** Document module
**Handler:** Create a timeline entry linking the document to the incident.

```typescript
@EventHandler('document.published.v1')
async handleDocumentPublished(event: DocumentPublishedEvent): Promise<void> {
  const { incidentId, documentId, title, actorId } = event.data;
  if (!incidentId) return;

  await this.timelineService.createEntry({
    incidentId,
    tenantId: event.tenantId,
    kind: 'document',
    actorId,
    payload: { documentId, title },
  });
}
```

#### iam.user.deactivated.v1

**Source:** IAM module
**Handler:** If the deactivated user is a commander of any active incident, alert shift_leads to reassign.

```typescript
@EventHandler('iam.user.deactivated.v1')
async handleUserDeactivated(event: UserDeactivatedEvent): Promise<void> {
  const { userId } = event.data;

  const affectedIncidents = await this.incidentRepository.findByCommanderId(userId, {
    statusIn: ['open', 'escalated', 'contained'],
  });

  for (const incident of affectedIncidents) {
    await this.notificationService.alertShiftLeads(incident.tenantId, {
      type: 'commander_deactivated',
      incidentId: incident.id,
      incidentCode: incident.code,
      deactivatedUserId: userId,
      message: `Incident commander for ${incident.code} has been deactivated. Immediate reassignment required.`,
    });
  }
}
```

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS incident;

-- =============================================================================
-- Sequence table for incident code generation
-- =============================================================================
CREATE TABLE incident.code_sequences (
    tenant_id   uuid        NOT NULL REFERENCES iam.tenants(id),
    year        smallint    NOT NULL,
    month       smallint    NOT NULL,
    last_seq    integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, year, month)
);

-- =============================================================================
-- incidents (main table)
-- =============================================================================
CREATE TABLE incident.incidents (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    code            text            NOT NULL,
    title           text            NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
    description     text            CHECK (char_length(description) <= 5000),
    category        text            NOT NULL CHECK (category IN (
                        'earthquake','flood','fire','wildfire','industrial',
                        'cbrn','mass_gathering','medical','transport','other'
                    )),
    severity        smallint        NOT NULL CHECK (severity BETWEEN 1 AND 4),
    status          text            NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft','open','escalated','contained','closed','archived'
                    )),
    classification  smallint        NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
    commander_id    uuid            REFERENCES iam.users(id),
    geofence        geography(Polygon, 4326),
    epicenter       geography(Point, 4326),
    opened_at       timestamptz,
    closed_at       timestamptz,
    parent_id       uuid            REFERENCES incident.incidents(id),
    metadata        jsonb           NOT NULL DEFAULT '{}',
    created_by      uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- Unique incident code (global)
CREATE UNIQUE INDEX idx_incidents_code ON incident.incidents (code);

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_incidents_tenant_id ON incident.incidents (tenant_id);

-- Status filtering
CREATE INDEX idx_incidents_tenant_status ON incident.incidents (tenant_id, status);

-- Severity + status for dashboard queries
CREATE INDEX idx_incidents_tenant_severity_status ON incident.incidents (tenant_id, severity, status);

-- Category filtering
CREATE INDEX idx_incidents_tenant_category ON incident.incidents (tenant_id, category);

-- Commander lookup
CREATE INDEX idx_incidents_commander_id ON incident.incidents (commander_id) WHERE commander_id IS NOT NULL;

-- Parent/child hierarchy
CREATE INDEX idx_incidents_parent_id ON incident.incidents (parent_id) WHERE parent_id IS NOT NULL;

-- Temporal: opened_at for date range queries
CREATE INDEX idx_incidents_tenant_opened_at ON incident.incidents (tenant_id, opened_at DESC);

-- Cursor-based pagination composite
CREATE INDEX idx_incidents_cursor ON incident.incidents (tenant_id, opened_at DESC, id DESC);

-- GIST index for geofence spatial queries
CREATE INDEX idx_incidents_geofence_gist ON incident.incidents USING GIST (geofence);

-- GIST index for epicenter spatial queries (KNN)
CREATE INDEX idx_incidents_epicenter_gist ON incident.incidents USING GIST (epicenter);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION incident.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incident.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incident.update_updated_at();

-- =============================================================================
-- participants
-- =============================================================================
CREATE TABLE incident.participants (
    incident_id      uuid        NOT NULL REFERENCES incident.incidents(id) ON DELETE CASCADE,
    user_id          uuid        NOT NULL REFERENCES iam.users(id),
    role_in_incident text        NOT NULL CHECK (role_in_incident IN (
                         'commander','deputy','liaison','observer','responder'
                     )),
    joined_at        timestamptz NOT NULL DEFAULT now(),
    left_at          timestamptz,
    PRIMARY KEY (incident_id, user_id)
);

CREATE INDEX idx_participants_user_id ON incident.participants (user_id);
CREATE INDEX idx_participants_active ON incident.participants (incident_id) WHERE left_at IS NULL;

-- =============================================================================
-- timeline (partitioned by month on ts)
-- =============================================================================
CREATE TABLE incident.timeline (
    id          uuid            NOT NULL DEFAULT gen_random_uuid(),
    incident_id uuid            NOT NULL,
    tenant_id   uuid            NOT NULL,
    ts          timestamptz     NOT NULL DEFAULT now(),
    kind        text            NOT NULL CHECK (kind IN (
                    'status_change','severity_change','assignment','sitrep',
                    'document','note','participant_joined','participant_left',
                    'geofence_update','epicenter_update','escalation',
                    'classification_change','commander_assigned',
                    'resource_deployed','resource_returned'
                )),
    actor_id    uuid            NOT NULL,
    payload     jsonb           NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- Create partitions for the current and next 3 months
-- In production, pg_partman manages partition creation automatically.
CREATE TABLE incident.timeline_2026_04 PARTITION OF incident.timeline
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE incident.timeline_2026_05 PARTITION OF incident.timeline
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE incident.timeline_2026_06 PARTITION OF incident.timeline
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE incident.timeline_2026_07 PARTITION OF incident.timeline
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Indexes on partitioned table (automatically created on partitions)
CREATE INDEX idx_timeline_incident_ts ON incident.timeline (incident_id, ts DESC);
CREATE INDEX idx_timeline_tenant_id ON incident.timeline (tenant_id);
CREATE INDEX idx_timeline_kind ON incident.timeline (incident_id, kind);

-- =============================================================================
-- sitreps
-- =============================================================================
CREATE TABLE incident.sitreps (
    id          uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id uuid                        NOT NULL REFERENCES incident.incidents(id),
    tenant_id   uuid                        NOT NULL,
    reporter_id uuid                        NOT NULL REFERENCES iam.users(id),
    location    geography(Point, 4326),
    severity    smallint                    CHECK (severity BETWEEN 1 AND 4),
    text        text                        NOT NULL CHECK (char_length(text) <= 10000),
    attachments uuid[]                      NOT NULL DEFAULT '{}',
    reported_at timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX idx_sitreps_incident_id ON incident.sitreps (incident_id, reported_at DESC);
CREATE INDEX idx_sitreps_tenant_id ON incident.sitreps (tenant_id);
CREATE INDEX idx_sitreps_location_gist ON incident.sitreps USING GIST (location);

-- =============================================================================
-- resources
-- =============================================================================
CREATE TABLE incident.resources (
    id              uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     uuid                    NOT NULL REFERENCES incident.incidents(id),
    tenant_id       uuid                    NOT NULL,
    resource_type   text                    NOT NULL CHECK (resource_type IN (
                        'vehicle','team','equipment','supply'
                    )),
    resource_id     text                    NOT NULL,
    name            text                    NOT NULL,
    status          text                    NOT NULL DEFAULT 'deployed' CHECK (status IN (
                        'deployed','en_route','returned'
                    )),
    deployed_at     timestamptz             NOT NULL DEFAULT now(),
    returned_at     timestamptz,
    location        geography(Point, 4326)
);

CREATE INDEX idx_resources_incident_id ON incident.resources (incident_id);
CREATE INDEX idx_resources_tenant_id ON incident.resources (tenant_id);
CREATE INDEX idx_resources_status ON incident.resources (incident_id, status);
CREATE INDEX idx_resources_location_gist ON incident.resources USING GIST (location);

-- =============================================================================
-- outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE incident.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'incident',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_outbox_unpublished ON incident.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE incident.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.sitreps ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident.resources ENABLE ROW LEVEL SECURITY;

-- Policy: incidents visible to same tenant, filtered by classification and draft visibility
CREATE POLICY tenant_isolation ON incident.incidents
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

CREATE POLICY classification_filter ON incident.incidents
    FOR SELECT
    USING (
        classification <= current_setting('app.current_user_clearance')::smallint
    );

CREATE POLICY draft_visibility ON incident.incidents
    FOR SELECT
    USING (
        status != 'draft'
        OR created_by = current_setting('app.current_user_id')::uuid
        OR current_setting('app.current_user_role_level')::smallint >= 3  -- shift_lead+
    );

-- Policy: participants — same tenant via join to incidents
CREATE POLICY tenant_isolation ON incident.participants
    USING (
        EXISTS (
            SELECT 1 FROM incident.incidents i
            WHERE i.id = incident_id
              AND i.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: timeline — direct tenant_id check (denormalized)
CREATE POLICY tenant_isolation ON incident.timeline
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: sitreps — direct tenant_id check
CREATE POLICY tenant_isolation ON incident.sitreps
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: resources — direct tenant_id check
CREATE POLICY tenant_isolation ON incident.resources
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );
```

### Incident Code Generation (Atomic Sequence)

```sql
-- Called within the CreateIncident transaction
-- Uses advisory lock to prevent race conditions on sequence increment
CREATE OR REPLACE FUNCTION incident.next_incident_code(
    p_tenant_id uuid,
    p_category  text,
    p_year      smallint,
    p_month     smallint
) RETURNS text AS $$
DECLARE
    v_seq       integer;
    v_code_prefix text;
    v_code      text;
BEGIN
    -- Advisory lock scoped to tenant + year + month
    PERFORM pg_advisory_xact_lock(
        hashtext(p_tenant_id::text || p_year::text || p_month::text)
    );

    INSERT INTO incident.code_sequences (tenant_id, year, month, last_seq)
    VALUES (p_tenant_id, p_year, p_month, 1)
    ON CONFLICT (tenant_id, year, month)
    DO UPDATE SET last_seq = incident.code_sequences.last_seq + 1
    RETURNING last_seq INTO v_seq;

    v_code_prefix := CASE p_category
        WHEN 'earthquake'     THEN 'EQ'
        WHEN 'flood'          THEN 'FL'
        WHEN 'fire'           THEN 'FR'
        WHEN 'wildfire'       THEN 'WF'
        WHEN 'industrial'     THEN 'IN'
        WHEN 'cbrn'           THEN 'CB'
        WHEN 'mass_gathering' THEN 'MG'
        WHEN 'medical'        THEN 'MD'
        WHEN 'transport'      THEN 'TR'
        WHEN 'other'          THEN 'OT'
    END;

    v_code := v_code_prefix || '-' || p_year::text || '-' || lpad(p_month::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');
    RETURN v_code;
END;
$$ LANGUAGE plpgsql;
```

### Sample PostGIS Queries

#### Find all GIS features within an incident's geofence

```sql
SELECT f.*
FROM gis.features f
JOIN incident.incidents i ON ST_Within(f.geometry, i.geofence::geometry)
WHERE i.id = :incidentId
  AND i.tenant_id = :tenantId;
```

#### Find nearest N field units to an incident's epicenter (KNN)

```sql
SELECT r.id, r.name, r.resource_type, r.status,
       ST_Distance(r.location, i.epicenter) AS distance_meters
FROM incident.resources r
JOIN incident.incidents i ON i.id = :incidentId
WHERE r.tenant_id = :tenantId
  AND r.status IN ('deployed', 'en_route')
ORDER BY r.location <-> i.epicenter
LIMIT :n;
```

#### Find all incidents whose geofence intersects a map viewport bbox

```sql
SELECT id, code, title, status, severity, category,
       ST_AsGeoJSON(epicenter)::jsonb AS epicenter_geojson,
       ST_AsGeoJSON(geofence)::jsonb AS geofence_geojson
FROM incident.incidents
WHERE tenant_id = :tenantId
  AND status NOT IN ('archived')
  AND ST_Intersects(
      geofence,
      ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography
  )
ORDER BY severity DESC, opened_at DESC;
```

#### Find all open incidents within radius of a point

```sql
SELECT id, code, title, severity, status,
       ST_Distance(epicenter, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_meters
FROM incident.incidents
WHERE tenant_id = :tenantId
  AND status IN ('open', 'escalated', 'contained')
  AND ST_DWithin(epicenter, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)
ORDER BY epicenter <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
LIMIT :limit;
```

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The incident module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Operation                      | Permission String              | Minimum Role       | Additional Conditions                       |
| ------------------------------ | ------------------------------ | ------------------ | ------------------------------------------- |
| List incidents                 | `incident.read`                | field_responder    | Filtered by classification vs user clearance|
| Get incident detail            | `incident.read`                | field_responder    | Classification check via ABAC               |
| Create incident                | `incident.create`              | duty_operator      |                                              |
| Update incident fields         | `incident.update`              | deputy/IC          | Incident not closed/archived                 |
| Transition: open               | `incident.update.status`       | creator or above   | From draft only                              |
| Transition: escalate           | `incident.update.status`       | IC or shift_lead   | Reason required                              |
| Transition: de-escalate        | `incident.update.status`       | shift_lead         |                                              |
| Transition: contain            | `incident.update.status`       | IC                 | Reason required                              |
| Transition: close              | `incident.update.status`       | IC                 | All tasks resolved + resolution_summary      |
| Transition: reopen             | `incident.update.status`       | shift_lead         | Reason required                              |
| Transition: archive            | `incident.update.status`       | tenant_admin       |                                              |
| Raise severity                 | `incident.update.severity`     | IC                 |                                              |
| Lower severity                 | `incident.update.severity`     | shift_lead         |                                              |
| Assign commander               | `incident.assign.commander`    | shift_lead         |                                              |
| Add participant                | `incident.update.participants` | IC/deputy          |                                              |
| Remove participant             | `incident.update.participants` | IC/shift_lead      | Cannot remove commander                      |
| Submit sitrep                  | `incident.sitrep.create`       | field_responder    | Must be active participant                   |
| Read sitreps                   | `incident.read`                | field_responder    | Same as incident read                        |
| Read timeline                  | `incident.read`                | field_responder    | Same as incident read                        |
| Update geofence                | `incident.update.geofence`     | IC/shift_lead      |                                              |
| Update epicenter               | `incident.update.epicenter`    | IC/shift_lead      |                                              |
| Link child incident            | `incident.update.hierarchy`    | shift_lead         |                                              |
| Raise classification           | `incident.classify`            | shift_lead         | Actor clearance >= target classification     |
| Delete incident                | N/A                            | N/A                | NEVER -- only archive                        |

### Role Hierarchy (Reference)

```
field_responder < duty_operator < incident_commander (IC) < shift_lead < tenant_admin < super_admin
```

### ABAC Classification Enforcement

The incident module delegates classification-based access control to the IAM PDP. The PDP evaluates:

```typescript
// Pseudocode for classification ABAC policy
const canAccessIncident = (user: User, incident: Incident): boolean => {
  // User clearance must be >= incident classification
  return user.clearance >= incident.classification;
};
```

This is enforced at two levels:

1. **Database level:** RLS policy `classification_filter` ensures queries never return incidents above the user's clearance
2. **Application level:** GetIncident handler performs an explicit check and returns `INCIDENT_NOT_FOUND` (not 403) to avoid leaking the existence of classified incidents

---

## 9. Edge Cases

### Failure Scenarios

**Database down during incident creation:**
- The API returns HTTP 503 with a `Retry-After` header
- If the transaction committed before the connection dropped, the outbox row exists and the outbox poller delivers the event when the database recovers
- Idempotency-Key ensures the client can safely retry without creating duplicates

**PostGIS query timeout on spatial queries:**
- The query layer sets a `statement_timeout` of 5 seconds for spatial queries
- If the timeout fires, the handler falls back to a non-spatial query (omitting the bbox/radius filter) and sets a response header `X-Degraded: spatial-query-timeout`
- The degradation is logged as a warning and emitted as a metric for alerting

**Commander user gets deactivated:**
- The `iam.user.deactivated.v1` event handler finds all active incidents where the deactivated user is commander
- An alert notification is sent to all shift_leads in the tenant with the list of affected incidents
- The incident remains in its current state -- no automatic commander reassignment to avoid introducing unexpected changes during an active incident
- If no reassignment happens within 30 minutes, a follow-up escalation alert is sent

**Concurrent sitrep submissions:**
- No conflict -- each sitrep creates its own independent row with a unique UUIDv7 ID
- Timeline entries are ordered by `ts`; in the rare case of identical timestamps, UUIDv7 ordering provides a deterministic tiebreaker
- No locking required on the incident row for sitrep submission

**Incident close attempted while task module is unavailable:**
- The close handler queries the task module for open task count
- If the query fails (timeout, connection error), the handler queries the local Redis cache for `incident:{id}:openTaskCount`
- If the cache has a value of 0, proceed with close (cache was maintained by task events)
- If the cache is missing or has a non-zero value, reject the close with error: `"Unable to verify task status. Please retry or contact shift lead for manual override."`

### Concurrency Issues

**Two users try to change severity simultaneously:**
- Optimistic locking on the `updated_at` column
- Each handler reads the incident with its `updated_at` value
- The UPDATE includes `WHERE updated_at = :expectedUpdatedAt`
- If the UPDATE affects 0 rows, the handler throws HTTP 409 CONFLICT with the current incident state in the response body so the client can reconcile

**Commander reassignment during active transition:**
- The `TransitionStatus` handler acquires a `FOR UPDATE` lock on the incident row for the duration of the transition
- If `AssignCommander` arrives concurrently, it blocks on the row lock until the transition completes
- After the transition releases the lock, the commander assignment proceeds normally against the updated state

**Geofence update while spatial query is running:**
- PostgreSQL's MVCC ensures the running spatial query sees a consistent snapshot of the data at its transaction start time
- The geofence update commits in a separate transaction; the spatial query does not see partial writes
- No explicit locking is needed

### Race Conditions

**Close request arrives milliseconds after a new task is created:**
- The close handler acquires a `FOR UPDATE` lock on the incident row
- Inside the same transaction, it queries the task count: `SELECT count(*) FROM task.tasks WHERE incident_id = :id AND status IN ('todo', 'in_progress', 'blocked')`
- The `FOR UPDATE` lock prevents the incident state from changing, and the task count query sees the newly created task
- The close is rejected with `INCIDENT_OPEN_TASKS_EXIST`

**Two sub-incidents try to link to the same parent:**
- No conflict -- `parent_id` is set on each child independently
- Each transaction validates the depth constraint for its own child
- No locking needed on the parent row since we are only reading its `parent_id` to compute depth

**Timeline partition creation race during month boundary:**
- `pg_partman` manages partition creation using advisory locks
- If two connections attempt to create the same partition simultaneously, the advisory lock serializes them and the second attempt is a no-op (partition already exists)
- The application never creates partitions directly -- it relies on `pg_partman`'s background worker

---

## 10. Geo Integration

### Storage

Incident uses PostgreSQL's `geography` type (not `geometry`) for all spatial data. The `geography` type uses geodetic coordinates on the WGS84 ellipsoid (EPSG:4326), which means all distance calculations are in meters and account for Earth's curvature.

| Column    | PostGIS Type               | Purpose                                    |
| --------- | -------------------------- | ------------------------------------------ |
| epicenter | geography(Point, 4326)     | Point of origin / center of the event      |
| geofence  | geography(Polygon, 4326)   | Area of operations / exclusion zone        |

### Indexing

```sql
-- GIST indexes for spatial queries
CREATE INDEX idx_incidents_geofence_gist ON incident.incidents USING GIST (geofence);
CREATE INDEX idx_incidents_epicenter_gist ON incident.incidents USING GIST (epicenter);
CREATE INDEX idx_sitreps_location_gist ON incident.sitreps USING GIST (location);
CREATE INDEX idx_resources_location_gist ON incident.resources USING GIST (location);
```

### Spatial Queries

#### Find all GIS features within an incident's geofence

Used by the GIS module to determine which features (buildings, roads, infrastructure) are within the affected area.

```sql
SELECT f.id, f.feature_type, f.name, f.properties,
       ST_AsGeoJSON(f.geometry)::jsonb AS geometry_geojson
FROM gis.features f
JOIN incident.incidents i ON i.id = :incidentId
WHERE i.tenant_id = :tenantId
  AND ST_Intersects(f.geometry::geography, i.geofence)
ORDER BY f.feature_type, f.name;
```

#### Find nearest N field units to epicenter (KNN with <-> operator)

Used to identify the closest deployed resources for rapid response.

```sql
SELECT r.id, r.name, r.resource_type, r.status,
       ST_AsGeoJSON(r.location)::jsonb AS location_geojson,
       ST_Distance(r.location, i.epicenter) AS distance_meters
FROM incident.resources r
JOIN incident.incidents i ON i.id = :incidentId
WHERE r.tenant_id = :tenantId
  AND r.status IN ('deployed', 'en_route')
  AND r.location IS NOT NULL
ORDER BY r.location <-> i.epicenter
LIMIT :n;
```

#### Find incidents whose geofence intersects a map viewport bbox

Used by the frontend map component to display all relevant incidents in the current viewport.

```sql
SELECT i.id, i.code, i.title, i.status, i.severity, i.category,
       ST_AsGeoJSON(i.epicenter)::jsonb AS epicenter_geojson,
       ST_AsGeoJSON(i.geofence)::jsonb AS geofence_geojson
FROM incident.incidents i
WHERE i.tenant_id = :tenantId
  AND i.status NOT IN ('draft', 'archived')
  AND (
      ST_Intersects(i.geofence, ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography)
      OR ST_DWithin(i.epicenter, ST_Centroid(ST_MakeEnvelope(:west, :south, :east, :north, 4326))::geography, :viewportDiagonalMeters)
  )
ORDER BY i.severity DESC, i.opened_at DESC;
```

#### Geofence change triggers

When a geofence is updated, the incident module emits `incident.geofence_updated.v1`. The GIS module consumes this event to:

1. Recalculate which `gis.features` fall within the new geofence
2. Update the affected feature list for the incident
3. Emit `gis.features_recalculated.v1` so downstream modules (e.g., Notification) can alert relevant personnel about newly affected areas

```typescript
// GIS module handler (for reference — this lives in the GIS module, not incident)
@EventHandler('incident.geofence_updated.v1')
async handleGeofenceUpdated(event: IncidentGeofenceUpdatedEvent): Promise<void> {
  const { incidentId, geofence } = event.data;

  // Find all features within the new geofence
  const features = await this.featureRepository.findWithinGeography(geofence);

  // Update the incident-feature mapping
  await this.incidentFeatureRepository.replaceForIncident(incidentId, features.map(f => f.id));

  // Emit event for downstream
  await this.eventBus.publish({
    type: 'gis.features_recalculated.v1',
    data: { incidentId, featureCount: features.length },
  });
}
```

---

## 11. Relations with Other Modules

### Tasks

**Relationship:** `task.tasks.incident_id` FK references `incident.incidents.id`

**Integration pattern:**
- The Task module owns all task data; the Incident module queries task status for the close gate
- Incident holds a Redis-cached count of open tasks per incident, maintained by consuming `task.status_changed.v1` and `task.completed.v1`
- The `GetIncident` query includes task stats (total count, open count) fetched either from cache or a cross-schema query

**Close gate enforcement:**

```typescript
// Inside TransitionStatus handler for 'close'
async validateCloseGate(incidentId: string): Promise<void> {
  // Primary: query task module directly
  try {
    const openCount = await this.taskQueryService.countOpenTasks(incidentId);
    if (openCount > 0) {
      throw new IncidentOpenTasksExistError(incidentId, openCount);
    }
    return;
  } catch (err) {
    if (err instanceof IncidentOpenTasksExistError) throw err;
    // Task module unavailable — fall back to cache
  }

  // Fallback: check Redis cache
  const cachedCount = await this.cacheService.get<number>(`incident:${incidentId}:openTaskCount`);
  if (cachedCount === null) {
    throw new UnableToVerifyTaskStatusError(incidentId);
  }
  if (cachedCount > 0) {
    throw new IncidentOpenTasksExistError(incidentId, cachedCount);
  }
}
```

### Documents

**Relationship:** `document.documents.incident_id` FK references `incident.incidents.id`

**Integration pattern:**
- Documents linked to an incident appear in the timeline via `document.published.v1` event consumption
- When an incident is closed (`incident.closed.v1`), the Document module can auto-generate a post-incident report by consuming the event and aggregating timeline data, sitreps, and participant lists
- The `GetIncident` detail query does not return document data directly; the frontend fetches documents separately via the Document module API filtered by `incident_id`

### Chat

**Relationship:** `chat.channels.incident_id` FK references `incident.incidents.id`

**Integration pattern:**
- **Channel creation:** The Chat module consumes `incident.created.v1` (when status is `open`) and auto-creates an `INCIDENT_ROOM` channel with the incident code as the channel name
- **Membership sync:** The Chat module consumes `incident.participant_added.v1` and `incident.participant_removed.v1` to add/remove members from the incident chat channel
- **Channel archival:** The Chat module consumes `incident.closed.v1` and archives the associated channel (read-only, no new messages)
- **Channel reactivation:** The Chat module consumes `incident.reopened.v1` and reactivates the channel

### GIS

**Relationship:** `gis.features.incident_id` FK for incident-specific map features (e.g., hazard zones, evacuation routes drawn by IC)

**Integration pattern:**
- The GIS module reads incident epicenter and geofence for map rendering
- The GIS module consumes `incident.geofence_updated.v1` to recalculate affected features
- The GIS module consumes `incident.epicenter_updated.v1` to update map center and recalculate proximity data
- Incident-specific features (drawn on the map by users) are owned by the GIS module but linked via `incident_id`

### Notification

**Integration pattern:**
- **CRITICAL severity:** When `incident.severity_changed.v1` carries `after: 4`, the Notification module sends a siren-level push notification to all `shift_lead` and `tenant_admin` users in the tenant
- **Status changes:** `incident.status_changed.v1` triggers a notification to all active participants of the incident
- **Commander assignment:** `incident.commander_assigned.v1` triggers a direct notification to the newly assigned commander
- **Sitrep submission:** `incident.sitrep.submitted.v1` triggers a notification to the incident commander and deputies
- **Deactivated commander alert:** Incident module directly calls the Notification service for the commander deactivation alert (synchronous, because this is an urgent operational concern)

### Analytics

**Integration pattern:**
- The Analytics module consumes ALL incident events to populate fact tables in its data warehouse schema
- Key metrics derived:
  - Response time: `opened_at` to first status change
  - Mean time to resolution (MTTR): `opened_at` to `closed_at`
  - Severity distribution over time
  - Incident frequency by category, region, time of day
  - Participant utilization (how many incidents per responder)
  - Sitrep frequency during active incidents
- The Analytics module maintains its own materialized views; the Incident module is not aware of analytics concerns
