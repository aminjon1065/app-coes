# Task Module -- Assignment, Tracking & SLA Management

## 1. Purpose

The Task module is the operational execution layer of the Sentinel disaster management platform. It manages all actionable work items -- whether spawned from an active incident response or created standalone for pre-incident planning, drills, and routine operations.

Tasks represent discrete units of work that must be assigned, tracked, and completed within defined timelines. The module provides full lifecycle management including assignment tracking, SLA enforcement, subtask decomposition, dependency graphs, and kanban-style board views for situational awareness.

### Ownership Boundaries

Task **owns**:

- The full task lifecycle (todo through done/cancelled)
- Task status state machine and transition enforcement
- Task assignments and reassignment history
- Subtask hierarchy (self-referencing parent/child, max depth 3)
- Task dependencies (finish-to-start relationships between tasks)
- Task comments (threaded discussion on individual tasks)
- SLA timers and breach detection
- Task templates and bulk creation from templates
- Position ordering within board columns (drag-drop)
- Task-scoped audit trail (every mutation produces a history record)

Task **does not own**:

- Incidents (owned by the Incident module; linked via optional `incident_id` FK)
- User identity and permissions (owned by IAM; task queries IAM for authorization)
- Notifications (owned by the Notification module; task emits events that Notification consumes)
- Documents and attachments (owned by the Document module; referenced by ID in task metadata)
- Chat channels (owned by the Chat module; task may reference a discussion thread)

---

## 2. Domain Model

### Aggregates

#### Task (Aggregate Root)

| Column          | Type            | Notes                                                                  |
| --------------- | --------------- | ---------------------------------------------------------------------- |
| id              | uuid (v7)       | PK                                                                     |
| tenant_id       | uuid            | FK -> iam.tenants, NOT NULL                                            |
| incident_id     | uuid            | FK -> incident.incidents, nullable (null = standalone/planning task)    |
| title           | text            | 3-300 chars, NOT NULL                                                  |
| description     | text            | Max 10000 chars, nullable                                              |
| status          | text            | CHECK (status IN enum list), NOT NULL, default 'todo'                  |
| priority        | smallint        | CHECK (priority BETWEEN 1 AND 4), NOT NULL, default 3                  |
| assignee_id     | uuid            | FK -> iam.users, nullable (null = unassigned)                          |
| assigner_id     | uuid            | FK -> iam.users, NOT NULL (who created/last assigned the task)         |
| due_at          | timestamptz     | Nullable, user-defined deadline                                        |
| sla_breach_at   | timestamptz     | Nullable, computed SLA deadline (set by policy or manually)            |
| started_at      | timestamptz     | Set when status transitions from todo to in_progress                   |
| completed_at    | timestamptz     | Set when status transitions to done                                    |
| parent_task_id  | uuid            | FK -> task.tasks (self-ref), nullable, max depth 3                     |
| position        | integer         | Ordering within a board column, NOT NULL, default 0                    |
| metadata        | jsonb           | Extensible key-value store for domain-specific data, default '{}'      |
| created_by      | uuid            | FK -> iam.users, NOT NULL, immutable                                   |
| created_at      | timestamptz     | Default now()                                                          |
| updated_at      | timestamptz     | Default now(), trigger-maintained                                      |
| deleted_at      | timestamptz     | Nullable, soft delete                                                  |

#### TaskComment (Entity)

| Column      | Type        | Notes                                                  |
| ----------- | ----------- | ------------------------------------------------------ |
| id          | uuid (v7)   | PK                                                     |
| task_id     | uuid        | FK -> task.tasks, NOT NULL                             |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL (denormalized for RLS)     |
| author_id   | uuid        | FK -> iam.users, NOT NULL                              |
| body        | text        | NOT NULL, 1-5000 chars                                 |
| created_at  | timestamptz | Default now()                                          |
| updated_at  | timestamptz | Default now()                                          |
| deleted_at  | timestamptz | Nullable, soft delete                                  |

#### TaskDependency (Entity)

| Column            | Type        | Notes                                                         |
| ----------------- | ----------- | ------------------------------------------------------------- |
| task_id           | uuid        | FK -> task.tasks, NOT NULL, part of composite PK              |
| depends_on_id     | uuid        | FK -> task.tasks, NOT NULL, part of composite PK              |
| tenant_id         | uuid        | FK -> iam.tenants, NOT NULL (denormalized for RLS)            |
| created_by        | uuid        | FK -> iam.users, NOT NULL                                     |
| created_at        | timestamptz | Default now()                                                 |

Constraint: `PRIMARY KEY (task_id, depends_on_id)`, `CHECK (task_id != depends_on_id)`

Semantics: `task_id` cannot start until `depends_on_id` is done or cancelled (finish-to-start).

#### TaskAssignmentHistory (Entity)

| Column          | Type        | Notes                                                  |
| --------------- | ----------- | ------------------------------------------------------ |
| id              | uuid (v7)   | PK                                                     |
| task_id         | uuid        | FK -> task.tasks, NOT NULL                             |
| tenant_id       | uuid        | FK -> iam.tenants, NOT NULL (denormalized for RLS)     |
| assignee_id     | uuid        | FK -> iam.users, nullable (null = unassigned)          |
| assigned_by     | uuid        | FK -> iam.users, NOT NULL                              |
| reason          | text        | Nullable, max 1000 chars                               |
| assigned_at     | timestamptz | Default now()                                          |

#### TaskTemplate (Entity)

| Column      | Type        | Notes                                                  |
| ----------- | ----------- | ------------------------------------------------------ |
| id          | uuid (v7)   | PK                                                     |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL                            |
| name        | text        | 3-200 chars, NOT NULL                                  |
| description | text        | Max 5000 chars, nullable                               |
| category    | text        | Nullable, freeform label for filtering                 |
| created_by  | uuid        | FK -> iam.users, NOT NULL                              |
| created_at  | timestamptz | Default now()                                          |
| updated_at  | timestamptz | Default now()                                          |
| deleted_at  | timestamptz | Nullable, soft delete                                  |

Constraint: `UNIQUE (tenant_id, name) WHERE deleted_at IS NULL`

#### TaskTemplateItem (Entity)

| Column           | Type        | Notes                                                       |
| ---------------- | ----------- | ----------------------------------------------------------- |
| id               | uuid (v7)   | PK                                                          |
| template_id      | uuid        | FK -> task.templates, NOT NULL                              |
| title            | text        | 3-300 chars, NOT NULL                                       |
| description      | text        | Max 10000 chars, nullable                                   |
| priority         | smallint    | CHECK (priority BETWEEN 1 AND 4), NOT NULL, default 3       |
| parent_item_id   | uuid        | FK -> task.template_items (self-ref), nullable              |
| position         | integer     | Ordering within the template, NOT NULL, default 0           |
| sla_duration_min | integer     | Nullable, SLA duration in minutes from task creation         |
| metadata         | jsonb       | Default '{}'                                                |

### Value Objects

**Priority**

```typescript
export enum TaskPriority {
  CRITICAL = 1,  // immediate action required, life-safety impact
  HIGH     = 2,  // urgent, significant operational impact
  MEDIUM   = 3,  // standard priority, normal workflow
  LOW      = 4,  // can be deferred, minimal impact
}
```

**Status**

```typescript
export enum TaskStatus {
  TODO        = 'todo',
  IN_PROGRESS = 'in_progress',
  BLOCKED     = 'blocked',
  REVIEW      = 'review',
  DONE        = 'done',
  CANCELLED   = 'cancelled',
}
```

**SLA (Value Object)**

```typescript
export class TaskSla {
  constructor(
    public readonly deadline: Date,       // when the SLA expires
    public readonly breachAt: Date | null, // when the breach was detected (null = not breached)
    public readonly breached: boolean,     // computed: breachAt != null || now() > deadline
  ) {}

  static fromDuration(createdAt: Date, durationMinutes: number): TaskSla {
    const deadline = new Date(createdAt.getTime() + durationMinutes * 60_000);
    return new TaskSla(deadline, null, false);
  }

  markBreached(at: Date): TaskSla {
    return new TaskSla(this.deadline, at, true);
  }
}
```

### State Machine

Every valid transition, its preconditions, and side effects:

```
 ┌──────┐
 │ todo │
 └──┬───┘
    │ start (requires: assignee_id set)
    │
    │──────────────────────────────────────────── cancel
    │                                               │
    ▼                                               ▼
 ┌─────────────┐                              ┌───────────┐
 │ in_progress │───── cancel ────────────────► │ cancelled │
 └──┬──┬──┬────┘                              └───────────┘
    │  │  │                                        ▲
    │  │  └──── block (requires: reason) ──┐       │
    │  │                                   ▼       │
    │  │                              ┌─────────┐  │
    │  │                              │ blocked │──┘ cancel
    │  │                              └────┬────┘
    │  │                                   │
    │  │       unblock (blocker resolved) ─┘
    │  │              │
    │  │              ▼
    │  │         back to in_progress
    │  │
    │  └──── submit_for_review
    │              │
    │              ▼
    │         ┌────────┐
    │         │ review │
    │         └──┬──┬──┘
    │            │  │
    │            │  └──── reject → in_progress
    │            │
    │            └──── approve → done
    │
    └──── complete (requires: all subtasks done/cancelled)
              │
              ▼
          ┌──────┐
          │ done │ (terminal — no edits, only comments)
          └──────┘
```

**Transition table (exhaustive):**

| From        | To          | Transition Code    | Preconditions                                                |
| ----------- | ----------- | ------------------ | ------------------------------------------------------------ |
| todo        | in_progress | start              | `assignee_id` must be set                                    |
| todo        | cancelled   | cancel             | None                                                         |
| in_progress | blocked     | block              | `reason` required in transition payload                      |
| in_progress | review      | submit_for_review  | None                                                         |
| in_progress | done        | complete           | All subtasks must be in `done` or `cancelled` status         |
| in_progress | cancelled   | cancel             | None                                                         |
| blocked     | in_progress | unblock            | None (blocker resolved)                                      |
| blocked     | cancelled   | cancel             | None                                                         |
| review      | done        | approve            | All subtasks must be in `done` or `cancelled` status         |
| review      | in_progress | reject             | None (rejection sends task back for rework)                  |
| done        | (terminal)  | --                 | No transitions out; only comments allowed                    |
| cancelled   | (terminal)  | --                 | No transitions out                                           |

**Invalid transitions (explicitly rejected):**

- `todo -> done` (must go through in_progress first)
- `todo -> review` (must go through in_progress first)
- `todo -> blocked` (must start first)
- `done -> any` (terminal state)
- `cancelled -> any` (terminal state)
- `review -> blocked` (reject to in_progress first, then block)
- `blocked -> done` (unblock first, then complete)

**Every transition MUST:**

1. Validate the transition is allowed from the current state
2. Check all preconditions
3. Create a `TaskAssignmentHistory` record if assignment changed
4. Emit `task.status_changed.v1` event via outbox
5. Update `updated_at` timestamp
6. If transitioning to `in_progress` from `todo`: set `started_at`
7. If transitioning to `done`: set `completed_at`
8. If transitioning to `done` and task has `incident_id`: emit `task.completed.v1`

```typescript
// Domain layer enforcement
export class Task {
  transitionTo(target: TaskStatus, actor: Actor, params: TransitionParams): DomainEvent[] {
    const transition = TRANSITION_MAP.get(`${this.status}->${target}`);
    if (!transition) {
      throw new TaskInvalidTransitionError(this.status, target);
    }
    transition.validate(this, params); // throws if preconditions not met

    const before = this.status;
    this.status = target;
    this.updatedAt = new Date();

    if (target === TaskStatus.IN_PROGRESS && before === TaskStatus.TODO) {
      this.startedAt = new Date();
    }
    if (target === TaskStatus.DONE) {
      this.completedAt = new Date();
    }

    const events: DomainEvent[] = [
      new TaskStatusChangedEvent({
        taskId: this.id,
        tenantId: this.tenantId,
        incidentId: this.incidentId,
        before,
        after: target,
        reason: params.reason,
        actorId: actor.userId,
      }),
    ];

    if (target === TaskStatus.DONE && this.incidentId) {
      events.push(
        new TaskCompletedEvent({
          taskId: this.id,
          tenantId: this.tenantId,
          incidentId: this.incidentId,
          completedAt: this.completedAt,
          actorId: actor.userId,
        }),
      );
    }

    return events;
  }

  private assertSubtasksComplete(subtasks: Task[]): void {
    const incomplete = subtasks.filter(
      s => s.status !== TaskStatus.DONE && s.status !== TaskStatus.CANCELLED,
    );
    if (incomplete.length > 0) {
      throw new TaskSubtasksIncompleteError(
        this.id,
        incomplete.map(s => s.id),
      );
    }
  }
}
```

---

## 3. Business Rules

### Invariants

1. **Optional incident linkage**: A task MAY have an `incident_id` (incident-linked task) or be standalone (`incident_id = NULL`). Both are valid. There is no mutual exclusivity constraint beyond the nullable FK.

2. **Done immutability**: A task in `DONE` status cannot have any field modified except: new comments may be added, and `deleted_at` may be set for soft delete. Any attempt to update a done task returns `TASK_DONE_IMMUTABLE`.

3. **Circular dependency prevention**: Before inserting a row into `task.dependencies`, a recursive CTE checks whether the proposed dependency would create a cycle. If a cycle is detected, the insert is rejected with `TASK_CIRCULAR_DEPENDENCY`. This check runs within the same transaction as the insert.

4. **SLA breach is informational**: When the SLA timer fires (via a scheduled job or cron), it emits `task.sla_breached.v1` but does NOT modify the task status. The event is consumed by the Notification module to alert stakeholders. SLA breach detection is idempotent -- if the task is already completed when the timer fires, the event is not emitted.

5. **Subtask completion gate**: A task CANNOT transition to `DONE` while any of its direct subtasks has status `TODO`, `IN_PROGRESS`, `BLOCKED`, or `REVIEW`. The domain entity validates this at transition time by loading all direct children.

6. **Incident participant constraint**: If a task is linked to an incident (`incident_id IS NOT NULL`), the `assignee_id` must be an active participant of that incident (verified by querying `incident.participants` where `left_at IS NULL`). Assignment to a non-participant is rejected with `TASK_ASSIGNEE_NOT_PARTICIPANT`.

7. **Max subtask depth**: The subtask hierarchy is limited to 3 levels (root task = level 0, child = level 1, grandchild = level 2, great-grandchild = level 3). Attempts to exceed this depth are rejected with `TASK_DEPTH_EXCEEDED`. Depth is calculated by walking up the `parent_task_id` chain.

8. **Position ordering**: The `position` field determines the order of tasks within a board column (status group). When a task is moved (drag-drop), only the `position` of the moved task is updated. The client receives a correction broadcast if concurrent moves cause conflicts.

9. **Template bulk creation**: Bulk creation from a template is fully transactional -- either all tasks from the template are created or none are. Partial creation is never committed.

10. **Tenant isolation**: A task can only reference an incident, assignee, and assigner within the same tenant. Cross-tenant references are rejected at the application layer and enforced at the database layer via RLS.

11. **Cancelled state side effects**: When a task is cancelled and other tasks depend on it, the system evaluates dependent tasks: if the tenant has `auto_unblock_on_cancel` enabled in settings, dependent tasks with status `BLOCKED` are automatically transitioned to `IN_PROGRESS`. Otherwise, dependent tasks remain blocked and a notification is sent to their assignees.

### Constraints

| Constraint                                      | Enforcement       |
| ----------------------------------------------- | ----------------- |
| `(task_id, depends_on_id)` unique dependency    | Composite PK      |
| `task_id != depends_on_id` no self-dependency   | CHECK constraint  |
| No circular dependencies                        | Recursive CTE fn  |
| `priority` between 1 and 4                      | CHECK constraint  |
| Status follows state machine                    | Domain layer      |
| `title` 3-300 chars                             | CHECK + app layer |
| `description` max 10000 chars                   | CHECK + app layer |
| `comment.body` 1-5000 chars                     | CHECK + app layer |
| `parent_task_id` same tenant as task            | App layer + RLS   |
| Max subtask depth 3                             | App layer         |
| Assignee must be incident participant (if linked)| App layer         |

### Validation Rules

```typescript
// Enforced at both DTO (class-validator) and domain entity level

// Title: 3-300 characters, no leading/trailing whitespace
title: string; // @Length(3, 300) @Trim()

// Description: max 10000 characters
description?: string; // @MaxLength(10000) @IsOptional()

// Priority: 1-4
priority: number; // @IsInt() @Min(1) @Max(4)

// Due date: must be in the future (at creation time)
dueAt?: string; // @IsISO8601() @IsOptional()

// Comment body: 1-5000 characters
body: string; // @Length(1, 5000) @Trim()

// Transition reason: required for block, 1-2000 chars
reason?: string; // @Length(1, 2000) @IsOptional()
```

---

## 4. Use Cases

### Commands

#### CreateTask

**Actor:** incident_commander+ for incident-linked tasks, shift_lead+ for standalone tasks
**Input:** title, description?, priority?, incident_id?, assignee_id?, due_at?, sla_breach_at?, parent_task_id?, metadata?
**Flow:**

1. Validate all input fields
2. If `incident_id` is provided, verify the incident exists and is not `closed` or `archived`
3. If `parent_task_id` is provided, verify the parent exists in the same tenant, calculate depth; reject with `TASK_DEPTH_EXCEEDED` if depth would exceed 3
4. If `assignee_id` is provided and `incident_id` is set, verify assignee is an active participant of the incident
5. Set `status = todo`, `assigner_id = actor.userId`, `created_by = actor.userId`
6. Set `position` to max position in the `todo` column for this incident/tenant + 1
7. Persist task
8. Create initial `TaskAssignmentHistory` record if `assignee_id` is set
9. Publish outbox message: `task.created.v1`
10. Return created task

**Idempotency:** Supports `Idempotency-Key` header. If a duplicate key is received, return the previously created task without side effects.

#### UpdateTask

**Actor:** assignee or incident_commander+
**Input:** title?, description?, priority?, due_at?, sla_breach_at?, metadata?
**Flow:**

1. Load task with `FOR UPDATE` lock
2. Verify task status is NOT `done` or `cancelled`; reject with `TASK_DONE_IMMUTABLE` if so
3. Validate changed fields
4. Apply changes
5. Publish `task.updated.v1` via outbox
6. Return updated task

#### TransitionStatus

**Actor:** assignee (for start, block, submit_for_review, complete), incident_commander+ (for cancel, approve, reject, unblock)
**Input:** transition code, reason? (required for block)
**Flow:**

1. Load task with `FOR UPDATE` lock
2. Call `task.transitionTo(target, actor, params)` -- domain method validates transition, preconditions
3. For `complete` and `approve` transitions: load all direct subtasks, verify all are `done` or `cancelled`
4. For `start` transition: verify `assignee_id` is set; if not, reject with `TASK_INVALID_TRANSITION` and message "Task must have an assignee before starting"
5. Persist updated task
6. Publish `task.status_changed.v1` via outbox
7. If transitioning to `done`: publish `task.completed.v1` via outbox

#### AssignTask

**Actor:** incident_commander+ for incident tasks, shift_lead+ for standalone tasks
**Input:** assignee_id, reason?
**Flow:**

1. Load task, verify not `done` or `cancelled`
2. If `incident_id` is set, verify new assignee is an active participant of the incident
3. Verify assignee belongs to the same tenant
4. Store previous `assignee_id`
5. Update `assignee_id` and `assigner_id = actor.userId`
6. Create `TaskAssignmentHistory` record with `reason`
7. Publish `task.assigned.v1` via outbox

#### ReassignTask

**Actor:** incident_commander+ for incident tasks, shift_lead+ for standalone tasks
**Input:** assignee_id, reason
**Flow:** Identical to AssignTask but `reason` is required. The distinction exists for audit clarity -- reassignment events carry different semantics in reporting.

#### AddComment

**Actor:** any participant (assignee, assigner, incident participant, or shift_lead+)
**Input:** body
**Flow:**

1. Load task, verify it exists (comments are allowed on `done` tasks)
2. Verify actor has comment permission (is assignee, assigner, incident participant, or shift_lead+)
3. Create `TaskComment` record
4. Publish `task.commented.v1` via outbox
5. Return created comment

#### CreateSubtask

**Actor:** same as CreateTask
**Input:** parent_task_id, title, description?, priority?, assignee_id?, due_at?, metadata?
**Flow:**

1. Load parent task, verify it exists and is in the same tenant
2. Calculate depth: walk up `parent_task_id` chain; reject with `TASK_DEPTH_EXCEEDED` if depth would reach 4 (parent at depth 3)
3. Inherit `incident_id` from parent task
4. Execute CreateTask flow with `parent_task_id` set
5. Return created subtask

#### AddDependency

**Actor:** incident_commander+ for incident tasks, shift_lead+ for standalone tasks
**Input:** depends_on_id
**Flow:**

1. Load both tasks, verify they exist and are in the same tenant
2. Verify `task_id != depends_on_id` (no self-dependency)
3. Run circular dependency check function (recursive CTE)
4. If cycle detected, reject with `TASK_CIRCULAR_DEPENDENCY`
5. Insert `TaskDependency` row
6. Publish `task.dependency_added.v1` via outbox

#### RemoveDependency

**Actor:** incident_commander+ for incident tasks, shift_lead+ for standalone tasks
**Input:** task_id, depends_on_id
**Flow:**

1. Verify dependency exists
2. Delete `TaskDependency` row
3. Publish `task.dependency_removed.v1` via outbox

#### BulkCreateFromTemplate

**Actor:** incident_commander+ for incident tasks, shift_lead+ for standalone tasks
**Input:** template_id, incident_id?, assignee_overrides? (map of template_item_id -> assignee_id)
**Flow:**

1. Load template and all its items, ordered by position
2. If `incident_id` is provided, verify incident exists and is not closed/archived
3. Begin transaction
4. For each template item (in dependency order, parents before children):
   a. Create task with fields from template item
   b. If `assignee_overrides` contains this item, set `assignee_id` accordingly
   c. If template item has `sla_duration_min`, compute `sla_breach_at = now() + duration`
   d. Map `parent_item_id` to the actual `parent_task_id` of the created parent task
5. Commit transaction (all or nothing)
6. Publish `task.created.v1` for each created task via outbox
7. Return array of created tasks

#### UpdatePosition

**Actor:** assignee or incident_commander+
**Input:** position (new integer position)
**Flow:**

1. Load task, verify not `done` or `cancelled`
2. Update `position` field
3. No event emitted (position changes are high-frequency, low-impact; broadcast via WebSocket instead)
4. Return updated task

### Queries

#### ListTasks

**Actor:** any authenticated user (filtered by incident participation for non-admins)
**Parameters:** cursor, limit (max 100, default 25), filters (incident_id, assignee_id, status, priority, due_before, due_after, parent_task_id), sort (priority_asc | priority_desc | due_at_asc | due_at_desc | created_at_desc | position_asc)
**Implementation:**

- RLS automatically filters by `tenant_id`
- For non-admin users: if `incident_id` filter is set, verify user is a participant of that incident; if no `incident_id` filter, return only tasks where user is assignee or assigner (unless user is shift_lead+)
- Cursor-based pagination using `(created_at, id)` composite cursor
- Redis cache for common queries (invalidated on task change events)
- `deleted_at IS NULL` filter applied automatically

#### GetTask

**Actor:** any authenticated user with task.read permission (or task.read.own for field_responder)
**Returns:** Full task DTO including:
- All task fields
- Subtasks (direct children only)
- Dependencies (both upstream and downstream)
- Latest 10 comments
- Assignment history
- Stats: `{ subtaskCount, completedSubtaskCount, commentCount, dependencyCount }`

#### GetTaskBoard

**Actor:** any authenticated user with task.read permission
**Parameters:** incident_id? (required for incident boards, omit for standalone board)
**Returns:** Tasks grouped by status column, ordered by position within each column.
**Implementation:**

```sql
SELECT
  t.id, t.title, t.status, t.priority, t.assignee_id,
  t.due_at, t.sla_breach_at, t.position, t.parent_task_id,
  (SELECT count(*) FROM task.tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
  (SELECT count(*) FROM task.tasks s WHERE s.parent_task_id = t.id AND s.status = 'done' AND s.deleted_at IS NULL) AS completed_subtask_count
FROM task.tasks t
WHERE t.tenant_id = :tenantId
  AND t.deleted_at IS NULL
  AND t.parent_task_id IS NULL  -- top-level tasks only for board view
  AND (:incidentId IS NULL OR t.incident_id = :incidentId)
ORDER BY t.status, t.position ASC, t.priority ASC, t.created_at ASC;
```

#### GetTaskDependencyGraph

**Actor:** any authenticated user with task.read permission
**Parameters:** incident_id or root task_id
**Returns:** Directed acyclic graph of task dependencies with status and assignee for each node.
**Implementation:**

```sql
WITH RECURSIVE dep_graph AS (
  SELECT t.id, t.title, t.status, t.assignee_id, t.priority,
         d.depends_on_id, 0 AS depth
  FROM task.tasks t
  LEFT JOIN task.dependencies d ON d.task_id = t.id
  WHERE t.incident_id = :incidentId
    AND t.tenant_id = :tenantId
    AND t.deleted_at IS NULL
)
SELECT * FROM dep_graph;
```

#### GetMyTasks

**Actor:** any authenticated user
**Parameters:** cursor, limit, filters (status, priority, due_before, due_after)
**Implementation:** `WHERE assignee_id = :currentUserId AND deleted_at IS NULL`, ordered by `priority ASC, due_at ASC NULLS LAST`.

#### GetOverdueTasks

**Actor:** shift_lead+
**Parameters:** incident_id?, cursor, limit
**Implementation:**

```sql
SELECT * FROM task.tasks
WHERE tenant_id = :tenantId
  AND deleted_at IS NULL
  AND due_at < now()
  AND status NOT IN ('done', 'cancelled')
  AND (:incidentId IS NULL OR incident_id = :incidentId)
ORDER BY due_at ASC, priority ASC;
```

#### GetSlaAtRiskTasks

**Actor:** shift_lead+
**Parameters:** incident_id?, threshold_minutes (default 30), cursor, limit
**Implementation:**

```sql
SELECT * FROM task.tasks
WHERE tenant_id = :tenantId
  AND deleted_at IS NULL
  AND sla_breach_at IS NOT NULL
  AND sla_breach_at <= now() + (:thresholdMinutes || ' minutes')::interval
  AND sla_breach_at > now()
  AND status NOT IN ('done', 'cancelled')
  AND (:incidentId IS NULL OR incident_id = :incidentId)
ORDER BY sla_breach_at ASC;
```

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max, Length,
  MaxLength, IsUUID, IsArray, IsISO8601, IsObject,
} from 'class-validator';

// ── Enums ────────────────────────────────────────────────

export enum TaskStatus {
  TODO        = 'todo',
  IN_PROGRESS = 'in_progress',
  BLOCKED     = 'blocked',
  REVIEW      = 'review',
  DONE        = 'done',
  CANCELLED   = 'cancelled',
}

export enum TaskPriority {
  CRITICAL = 1,
  HIGH     = 2,
  MEDIUM   = 3,
  LOW      = 4,
}

// ── Command DTOs ─────────────────────────────────────────

export class CreateTaskDto {
  @IsString()
  @Length(3, 300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number; // defaults to 3 (MEDIUM)

  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsISO8601()
  slaBreachAt?: string;

  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(3, 300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsISO8601()
  slaBreachAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TransitionStatusDto {
  @IsString()
  @IsEnum(['start', 'block', 'unblock', 'submit_for_review', 'complete', 'approve', 'reject', 'cancel'])
  transition: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}

export class AssignTaskDto {
  @IsUUID()
  assigneeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class AddCommentDto {
  @IsString()
  @Length(1, 5000)
  body: string;
}

export class AddDependencyDto {
  @IsUUID()
  dependsOnId: string;
}

export class BulkCreateFromTemplateDto {
  @IsUUID()
  templateId: string;

  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @IsObject()
  assigneeOverrides?: Record<string, string>; // template_item_id -> assignee_id
}

export class UpdatePositionDto {
  @IsInt()
  @Min(0)
  position: number;
}

// ── Query DTOs ───────────────────────────────────────────

export class ListTasksQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number; // default 25

  @IsOptional()
  @IsUUID()
  'filter[incident_id]'?: string;

  @IsOptional()
  @IsUUID()
  'filter[assignee_id]'?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  'filter[status]'?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  'filter[priority]'?: number;

  @IsOptional()
  @IsISO8601()
  'filter[due_before]'?: string;

  @IsOptional()
  @IsISO8601()
  'filter[due_after]'?: string;

  @IsOptional()
  @IsUUID()
  'filter[parent_task_id]'?: string;

  @IsOptional()
  @IsEnum(['priority_asc', 'priority_desc', 'due_at_asc', 'due_at_desc', 'created_at_desc', 'position_asc'])
  sort?: string;
}

// ── Response DTOs ────────────────────────────────────────

export class TaskDto {
  id: string;
  tenantId: string;
  incidentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigneeId: string | null;
  assignerId: string;
  dueAt: string | null;
  slaBreachAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  parentTaskId: string | null;
  position: number;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class TaskDetailDto extends TaskDto {
  subtasks: TaskDto[];
  dependsOn: TaskDependencyDto[];    // upstream: tasks this task depends on
  dependedOnBy: TaskDependencyDto[]; // downstream: tasks that depend on this task
  latestComments: TaskCommentDto[];
  assignmentHistory: TaskAssignmentDto[];
  stats: {
    subtaskCount: number;
    completedSubtaskCount: number;
    commentCount: number;
    dependencyCount: number;
  };
}

export class TaskDependencyDto {
  taskId: string;
  dependsOnId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  createdBy: string;
  createdAt: string;
}

export class TaskCommentDto {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export class TaskAssignmentDto {
  id: string;
  taskId: string;
  assigneeId: string | null;
  assignedBy: string;
  reason: string | null;
  assignedAt: string;
}

export class TaskBoardDto {
  todo: TaskDto[];
  inProgress: TaskDto[];
  blocked: TaskDto[];
  review: TaskDto[];
  done: TaskDto[];
  cancelled: TaskDto[];
}

export class AvailableTransitionDto {
  code: string;
  label: string;
  requires: string[]; // e.g., ['reason'] for block
}
```

### Endpoints

```
POST   /api/v1/tasks
  Body: CreateTaskDto
  Headers: Idempotency-Key (optional, UUID)
  Response 201: { data: TaskDto }
  Errors: 400 (validation), 422 TASK_DEPTH_EXCEEDED,
          422 TASK_ASSIGNEE_NOT_PARTICIPANT

GET    /api/v1/tasks
  Query: cursor, limit (1-100, default 25),
         filter[incident_id], filter[assignee_id], filter[status],
         filter[priority], filter[due_before], filter[due_after],
         filter[parent_task_id],
         sort (priority_asc | priority_desc | due_at_asc | due_at_desc | created_at_desc | position_asc)
  Response 200: { data: TaskDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/tasks/:id
  Response 200: { data: TaskDetailDto }
  Errors: 404 TASK_NOT_FOUND

PATCH  /api/v1/tasks/:id
  Body: UpdateTaskDto
  Response 200: { data: TaskDto }
  Errors: 404 TASK_NOT_FOUND, 422 TASK_DONE_IMMUTABLE

POST   /api/v1/tasks/:id/transitions
  Body: TransitionStatusDto
  Response 200: { data: TaskDto }
  Errors: 422 TASK_INVALID_TRANSITION,
          422 TASK_SUBTASKS_INCOMPLETE,
          422 TASK_DONE_IMMUTABLE

GET    /api/v1/tasks/:id/transitions/available
  Response 200: { data: AvailableTransitionDto[] }

POST   /api/v1/tasks/:id/assign
  Body: AssignTaskDto
  Response 200: { data: TaskDto }
  Errors: 422 TASK_DONE_IMMUTABLE,
          422 TASK_ASSIGNEE_NOT_PARTICIPANT

POST   /api/v1/tasks/:id/comments
  Body: AddCommentDto
  Response 201: { data: TaskCommentDto }

GET    /api/v1/tasks/:id/comments
  Query: cursor, limit (1-100, default 50)
  Response 200: { data: TaskCommentDto[], page: { nextCursor, prevCursor, limit, hasMore } }

POST   /api/v1/tasks/:id/dependencies
  Body: AddDependencyDto
  Response 201: { data: TaskDependencyDto }
  Errors: 422 TASK_CIRCULAR_DEPENDENCY

DELETE /api/v1/tasks/:id/dependencies/:depId
  Response 204
  Errors: 404 TASK_NOT_FOUND

POST   /api/v1/tasks/bulk
  Body: BulkCreateFromTemplateDto
  Response 201: { data: TaskDto[] }
  Errors: 404 (template not found), 422 TASK_ASSIGNEE_NOT_PARTICIPANT

PATCH  /api/v1/tasks/:id/position
  Body: UpdatePositionDto
  Response 200: { data: TaskDto }
  Errors: 422 TASK_DONE_IMMUTABLE

GET    /api/v1/tasks/board
  Query: incident_id (optional)
  Response 200: { data: TaskBoardDto }

GET    /api/v1/tasks/my
  Query: cursor, limit, filter[status], filter[priority],
         filter[due_before], filter[due_after]
  Response 200: { data: TaskDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/tasks/overdue
  Query: incident_id (optional), cursor, limit
  Response 200: { data: TaskDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/tasks/sla-at-risk
  Query: incident_id (optional), threshold_minutes (default 30), cursor, limit
  Response 200: { data: TaskDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/tasks/:id/dependency-graph
  Response 200: { data: { nodes: TaskDto[], edges: TaskDependencyDto[] } }
```

### Error Codes

| Code                          | HTTP | Description                                                              |
| ----------------------------- | ---- | ------------------------------------------------------------------------ |
| TASK_NOT_FOUND                | 404  | Task does not exist or is not visible to the requesting user             |
| TASK_INVALID_TRANSITION       | 422  | Requested status transition is not valid from the current state          |
| TASK_CIRCULAR_DEPENDENCY      | 422  | Adding this dependency would create a cycle in the dependency graph      |
| TASK_SUBTASKS_INCOMPLETE      | 422  | Cannot complete task; one or more subtasks are not done/cancelled        |
| TASK_DONE_IMMUTABLE           | 422  | Task in DONE status cannot be modified (only comments allowed)           |
| TASK_ASSIGNEE_NOT_PARTICIPANT | 422  | Assignee is not an active participant of the linked incident             |
| TASK_DEPTH_EXCEEDED           | 422  | Subtask hierarchy would exceed maximum depth of 3 levels                 |
| TASK_SLA_ALREADY_SET          | 422  | SLA breach time is already set and task is in progress (use update)      |
| TASK_DEPENDENCY_NOT_FOUND     | 404  | The specified dependency relationship does not exist                     |
| TASK_TEMPLATE_NOT_FOUND       | 404  | The specified template does not exist or is deleted                      |
| TASK_CANCELLED_IMMUTABLE      | 422  | Task in CANCELLED status cannot be modified                              |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes a standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "task.created.v1"
  source: string;      // "task-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### task.created.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000001",
  "type": "task.created.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:00:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000099",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Establish water distribution point at Sector 4",
    "priority": 1,
    "status": "todo",
    "assigneeId": "019526a0-1000-7000-8000-000000000070",
    "assignerId": "019526a0-1000-7000-8000-000000000060",
    "dueAt": "2026-04-12T15:00:00.000Z",
    "slaBreachAt": "2026-04-12T13:00:00.000Z",
    "parentTaskId": null,
    "createdBy": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### task.updated.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000002",
  "type": "task.updated.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:30:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000100",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "changes": {
      "title": {
        "before": "Establish water distribution point at Sector 4",
        "after": "Establish water distribution point at Sector 4 (Priority Upgraded)"
      },
      "priority": {
        "before": 2,
        "after": 1
      }
    },
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### task.assigned.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000003",
  "type": "task.assigned.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:15:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000101",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "previousAssigneeId": null,
    "newAssigneeId": "019526a0-1000-7000-8000-000000000070",
    "assignedBy": "019526a0-1000-7000-8000-000000000060",
    "reason": "Field team lead for Sector 4"
  }
}
```

#### task.status_changed.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000004",
  "type": "task.status_changed.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000102",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "before": "todo",
    "after": "in_progress",
    "reason": null,
    "actorId": "019526a0-1000-7000-8000-000000000070"
  }
}
```

#### task.sla_breached.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000005",
  "type": "task.sla_breached.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T13:00:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000103",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Establish water distribution point at Sector 4",
    "priority": 1,
    "assigneeId": "019526a0-1000-7000-8000-000000000070",
    "slaBreachAt": "2026-04-12T13:00:00.000Z",
    "currentStatus": "in_progress",
    "startedAt": "2026-04-12T10:00:00.000Z",
    "elapsedMinutes": 180
  }
}
```

#### task.completed.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000006",
  "type": "task.completed.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T14:30:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000104",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Establish water distribution point at Sector 4",
    "completedAt": "2026-04-12T14:30:00.000Z",
    "startedAt": "2026-04-12T10:00:00.000Z",
    "durationMinutes": 270,
    "slaBreached": true,
    "actorId": "019526a0-1000-7000-8000-000000000070"
  }
}
```

#### task.commented.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000007",
  "type": "task.commented.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:00:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000105",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "commentId": "019526b0-1000-7000-8000-000000000090",
    "authorId": "019526a0-1000-7000-8000-000000000070",
    "bodyPreview": "Water tanker arriving at 11:30. Need 3 additional volunteers for distribution."
  }
}
```

#### task.dependency_added.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000008",
  "type": "task.dependency_added.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:05:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000106",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "dependsOnId": "019526b0-1000-7000-8000-000000000011",
    "taskTitle": "Establish water distribution point at Sector 4",
    "dependsOnTitle": "Secure water tanker from municipal supply",
    "createdBy": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### task.dependency_removed.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000009",
  "type": "task.dependency_removed.v1",
  "source": "task-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:45:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000107",
  "data": {
    "taskId": "019526b0-1000-7000-8000-000000000010",
    "dependsOnId": "019526b0-1000-7000-8000-000000000011",
    "removedBy": "019526a0-1000-7000-8000-000000000060"
  }
}
```

### Consumed Events

#### incident.closed.v1

**Source:** Incident module
**Handler:** Cancel all remaining open tasks linked to the closed incident. Tasks in `done` or `cancelled` are left untouched.

```typescript
@EventHandler('incident.closed.v1')
async handleIncidentClosed(event: IncidentClosedEvent): Promise<void> {
  const { incidentId } = event.data;

  const openTasks = await this.taskRepository.findByIncidentId(incidentId, {
    statusIn: ['todo', 'in_progress', 'blocked', 'review'],
  });

  for (const task of openTasks) {
    const events = task.transitionTo(TaskStatus.CANCELLED, Actor.system(), {
      reason: `Auto-cancelled: incident ${event.data.code} closed`,
    });
    await this.taskRepository.save(task);
    await this.outboxService.publishAll(events);
  }
}
```

#### incident.created.v1

**Source:** Incident module
**Handler:** If the tenant has an auto-template configured for the incident's category, automatically create tasks from that template.

```typescript
@EventHandler('incident.created.v1')
async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
  const { incidentId, category, tenantId } = event.data;

  const tenantSettings = await this.tenantSettingsService.get(tenantId);
  const templateId = tenantSettings.autoTemplateMap?.[category];
  if (!templateId) return;

  const template = await this.templateRepository.findById(templateId);
  if (!template || template.deletedAt) return;

  await this.bulkCreateFromTemplateUseCase.execute({
    templateId,
    incidentId,
    actorId: event.data.createdBy,
    tenantId,
  });
}
```

#### iam.user.deactivated.v1

**Source:** IAM module
**Handler:** Find all active tasks assigned to the deactivated user and alert their incident commanders or shift leads for reassignment.

```typescript
@EventHandler('iam.user.deactivated.v1')
async handleUserDeactivated(event: UserDeactivatedEvent): Promise<void> {
  const { userId, tenantId } = event.data;

  const affectedTasks = await this.taskRepository.findByAssigneeId(userId, {
    statusIn: ['todo', 'in_progress', 'blocked', 'review'],
  });

  for (const task of affectedTasks) {
    // Flag the task metadata with deactivated assignee warning
    task.metadata = {
      ...task.metadata,
      _assigneeDeactivated: true,
      _assigneeDeactivatedAt: event.timestamp,
    };
    await this.taskRepository.save(task);

    // Determine who to notify
    const notifyUserId = task.incidentId
      ? await this.incidentQueryService.getCommanderId(task.incidentId)
      : task.assignerId;

    if (notifyUserId) {
      await this.notificationService.send(notifyUserId, {
        type: 'task_assignee_deactivated',
        taskId: task.id,
        taskTitle: task.title,
        deactivatedUserId: userId,
        message: `Task "${task.title}" is assigned to a deactivated user. Immediate reassignment required.`,
      });
    }
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
CREATE SCHEMA IF NOT EXISTS task;

-- =============================================================================
-- tasks (main table)
-- =============================================================================
CREATE TABLE task.tasks (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    incident_id     uuid            REFERENCES incident.incidents(id),
    title           text            NOT NULL CHECK (char_length(title) BETWEEN 3 AND 300),
    description     text            CHECK (char_length(description) <= 10000),
    status          text            NOT NULL DEFAULT 'todo' CHECK (status IN (
                        'todo','in_progress','blocked','review','done','cancelled'
                    )),
    priority        smallint        NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
    assignee_id     uuid            REFERENCES iam.users(id),
    assigner_id     uuid            NOT NULL REFERENCES iam.users(id),
    due_at          timestamptz,
    sla_breach_at   timestamptz,
    started_at      timestamptz,
    completed_at    timestamptz,
    parent_task_id  uuid            REFERENCES task.tasks(id),
    position        integer         NOT NULL DEFAULT 0,
    metadata        jsonb           NOT NULL DEFAULT '{}',
    created_by      uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_tasks_tenant_id ON task.tasks (tenant_id);

-- Incident lookup (all tasks for an incident)
CREATE INDEX idx_tasks_incident_id ON task.tasks (incident_id) WHERE incident_id IS NOT NULL;

-- Incident + status (for task board view and close-gate check)
CREATE INDEX idx_tasks_incident_status ON task.tasks (incident_id, status)
    WHERE incident_id IS NOT NULL AND deleted_at IS NULL;

-- Assignee active tasks (for "my tasks" query)
CREATE INDEX idx_tasks_assignee_active ON task.tasks (assignee_id, status)
    WHERE assignee_id IS NOT NULL
      AND status NOT IN ('done', 'cancelled')
      AND deleted_at IS NULL;

-- SLA breach monitoring (for scheduled SLA check job)
CREATE INDEX idx_tasks_sla_breach ON task.tasks (sla_breach_at)
    WHERE sla_breach_at IS NOT NULL
      AND status NOT IN ('done', 'cancelled')
      AND deleted_at IS NULL;

-- Overdue tasks
CREATE INDEX idx_tasks_overdue ON task.tasks (due_at)
    WHERE due_at IS NOT NULL
      AND status NOT IN ('done', 'cancelled')
      AND deleted_at IS NULL;

-- Parent task lookup (subtasks)
CREATE INDEX idx_tasks_parent ON task.tasks (parent_task_id)
    WHERE parent_task_id IS NOT NULL;

-- Board view ordering
CREATE INDEX idx_tasks_board ON task.tasks (tenant_id, incident_id, status, position)
    WHERE deleted_at IS NULL;

-- Cursor-based pagination composite
CREATE INDEX idx_tasks_cursor ON task.tasks (tenant_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

-- Priority filtering
CREATE INDEX idx_tasks_tenant_priority ON task.tasks (tenant_id, priority, status)
    WHERE deleted_at IS NULL;

-- Soft delete filter
CREATE INDEX idx_tasks_not_deleted ON task.tasks (id)
    WHERE deleted_at IS NULL;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION task.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON task.tasks
    FOR EACH ROW
    EXECUTE FUNCTION task.update_updated_at();

-- =============================================================================
-- dependencies
-- =============================================================================
CREATE TABLE task.dependencies (
    task_id         uuid        NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
    depends_on_id   uuid        NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
    tenant_id       uuid        NOT NULL REFERENCES iam.tenants(id),
    created_by      uuid        NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, depends_on_id),
    CHECK (task_id != depends_on_id)
);

CREATE INDEX idx_dependencies_depends_on ON task.dependencies (depends_on_id);
CREATE INDEX idx_dependencies_tenant ON task.dependencies (tenant_id);

-- =============================================================================
-- comments
-- =============================================================================
CREATE TABLE task.comments (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     uuid            NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
    tenant_id   uuid            NOT NULL REFERENCES iam.tenants(id),
    author_id   uuid            NOT NULL REFERENCES iam.users(id),
    body        text            NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX idx_comments_task_id ON task.comments (task_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_tenant ON task.comments (tenant_id);

CREATE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON task.comments
    FOR EACH ROW
    EXECUTE FUNCTION task.update_updated_at();

-- =============================================================================
-- assignments_history
-- =============================================================================
CREATE TABLE task.assignments_history (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     uuid            NOT NULL REFERENCES task.tasks(id) ON DELETE CASCADE,
    tenant_id   uuid            NOT NULL REFERENCES iam.tenants(id),
    assignee_id uuid            REFERENCES iam.users(id),
    assigned_by uuid            NOT NULL REFERENCES iam.users(id),
    reason      text            CHECK (char_length(reason) <= 1000),
    assigned_at timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_task_id ON task.assignments_history (task_id, assigned_at DESC);
CREATE INDEX idx_assignments_tenant ON task.assignments_history (tenant_id);
CREATE INDEX idx_assignments_assignee ON task.assignments_history (assignee_id)
    WHERE assignee_id IS NOT NULL;

-- =============================================================================
-- templates
-- =============================================================================
CREATE TABLE task.templates (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid            NOT NULL REFERENCES iam.tenants(id),
    name        text            NOT NULL CHECK (char_length(name) BETWEEN 3 AND 200),
    description text            CHECK (char_length(description) <= 5000),
    category    text,
    created_by  uuid            NOT NULL REFERENCES iam.users(id),
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE UNIQUE INDEX idx_templates_tenant_name ON task.templates (tenant_id, name)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_templates_tenant ON task.templates (tenant_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_templates_category ON task.templates (tenant_id, category)
    WHERE deleted_at IS NULL AND category IS NOT NULL;

CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON task.templates
    FOR EACH ROW
    EXECUTE FUNCTION task.update_updated_at();

-- =============================================================================
-- template_items
-- =============================================================================
CREATE TABLE task.template_items (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id      uuid         NOT NULL REFERENCES task.templates(id) ON DELETE CASCADE,
    title            text         NOT NULL CHECK (char_length(title) BETWEEN 3 AND 300),
    description      text         CHECK (char_length(description) <= 10000),
    priority         smallint     NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
    parent_item_id   uuid         REFERENCES task.template_items(id),
    position         integer      NOT NULL DEFAULT 0,
    sla_duration_min integer      CHECK (sla_duration_min > 0),
    metadata         jsonb        NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_template_items_template ON task.template_items (template_id, position);
CREATE INDEX idx_template_items_parent ON task.template_items (parent_item_id)
    WHERE parent_item_id IS NOT NULL;

-- =============================================================================
-- outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE task.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'task',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_outbox_unpublished ON task.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Circular dependency check function
-- =============================================================================
CREATE OR REPLACE FUNCTION task.check_circular_dependency(
    p_task_id       uuid,
    p_depends_on_id uuid
) RETURNS boolean AS $$
DECLARE
    v_has_cycle boolean;
BEGIN
    -- Check if adding p_task_id -> p_depends_on_id would create a cycle.
    -- A cycle exists if p_task_id is reachable from p_depends_on_id
    -- by following existing depends_on_id edges.
    WITH RECURSIVE dep_chain AS (
        -- Start from the proposed dependency target
        SELECT depends_on_id AS node_id, 1 AS depth
        FROM task.dependencies
        WHERE task_id = p_depends_on_id
        UNION ALL
        SELECT d.depends_on_id, dc.depth + 1
        FROM task.dependencies d
        JOIN dep_chain dc ON d.task_id = dc.node_id
        WHERE dc.depth < 100  -- safety limit to prevent infinite recursion
    )
    SELECT EXISTS (
        SELECT 1 FROM dep_chain WHERE node_id = p_task_id
    ) INTO v_has_cycle;

    RETURN v_has_cycle;
END;
$$ LANGUAGE plpgsql STABLE;

-- Convenience: trigger-based enforcement (optional, defense-in-depth)
CREATE OR REPLACE FUNCTION task.trg_check_circular_dependency()
RETURNS TRIGGER AS $$
BEGIN
    IF task.check_circular_dependency(NEW.task_id, NEW.depends_on_id) THEN
        RAISE EXCEPTION 'Circular dependency detected: task % -> % would create a cycle',
            NEW.task_id, NEW.depends_on_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dependencies_no_cycle
    BEFORE INSERT ON task.dependencies
    FOR EACH ROW
    EXECUTE FUNCTION task.trg_check_circular_dependency();

-- =============================================================================
-- Subtask depth check function
-- =============================================================================
CREATE OR REPLACE FUNCTION task.get_task_depth(p_task_id uuid)
RETURNS integer AS $$
DECLARE
    v_depth integer := 0;
    v_current_id uuid := p_task_id;
BEGIN
    LOOP
        SELECT parent_task_id INTO v_current_id
        FROM task.tasks
        WHERE id = v_current_id;

        EXIT WHEN v_current_id IS NULL;
        v_depth := v_depth + 1;

        IF v_depth > 3 THEN
            RETURN v_depth; -- early exit, already exceeded
        END IF;
    END LOOP;

    RETURN v_depth;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE task.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.assignments_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.template_items ENABLE ROW LEVEL SECURITY;

-- Policy: tasks visible to same tenant
CREATE POLICY tenant_isolation ON task.tasks
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: field_responder can only see their assigned tasks
CREATE POLICY own_tasks_for_responder ON task.tasks
    FOR SELECT
    USING (
        current_setting('app.current_user_role_level')::smallint >= 2  -- duty_operator+
        OR assignee_id = current_setting('app.current_user_id')::uuid
        OR assigner_id = current_setting('app.current_user_id')::uuid
        OR created_by = current_setting('app.current_user_id')::uuid
    );

-- Policy: dependencies — same tenant
CREATE POLICY tenant_isolation ON task.dependencies
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: comments — same tenant
CREATE POLICY tenant_isolation ON task.comments
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: assignments_history — same tenant
CREATE POLICY tenant_isolation ON task.assignments_history
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: templates — same tenant
CREATE POLICY tenant_isolation ON task.templates
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: template_items — via template join
CREATE POLICY tenant_isolation ON task.template_items
    USING (
        EXISTS (
            SELECT 1 FROM task.templates t
            WHERE t.id = template_id
              AND t.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );
```

### SLA Breach Detection Job

```sql
-- Scheduled job (runs every minute via pg_cron or application-level scheduler)
-- Finds tasks that have breached their SLA and have not yet been flagged.
-- The application reads these results and emits task.sla_breached.v1 events.

SELECT id, tenant_id, incident_id, title, priority, assignee_id,
       sla_breach_at, status, started_at,
       EXTRACT(EPOCH FROM (now() - started_at)) / 60 AS elapsed_minutes
FROM task.tasks
WHERE sla_breach_at <= now()
  AND sla_breach_at > now() - interval '5 minutes'  -- window to avoid reprocessing old breaches
  AND status NOT IN ('done', 'cancelled')
  AND deleted_at IS NULL
  AND NOT (metadata ? '_sla_breach_emitted');       -- idempotency flag in metadata
```

After emitting the event, the application sets `metadata['_sla_breach_emitted'] = true` to prevent duplicate emissions.

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The task module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Operation                       | Permission String       | Minimum Role             | Additional Conditions                                    |
| ------------------------------- | ----------------------- | ------------------------ | -------------------------------------------------------- |
| List tasks                      | `task.read`             | duty_operator            | Filtered by incident participation for non-admins        |
| Get task detail                 | `task.read`             | duty_operator            |                                                           |
| List own tasks (my tasks)       | `task.read.own`         | field_responder          | Only tasks where user is assignee                        |
| Create incident-linked task     | `task.create`           | incident_commander       | Must be IC or above of the linked incident               |
| Create standalone task          | `task.create`           | shift_lead               |                                                           |
| Update task fields              | `task.update`           | assignee or IC           | Task not done/cancelled                                  |
| Transition: start               | `task.update.status`    | assignee                 | Assignee must be set                                     |
| Transition: block               | `task.update.status`    | assignee                 | Reason required                                          |
| Transition: unblock             | `task.update.status`    | assignee or IC           |                                                           |
| Transition: submit_for_review   | `task.update.status`    | assignee                 |                                                           |
| Transition: complete            | `task.update.status`    | assignee                 | All subtasks done/cancelled                              |
| Transition: approve             | `task.update.status`    | incident_commander       | All subtasks done/cancelled                              |
| Transition: reject              | `task.update.status`    | incident_commander       |                                                           |
| Transition: cancel              | `task.update.status`    | incident_commander       |                                                           |
| Assign task                     | `task.assign`           | incident_commander       |                                                           |
| Reassign task                   | `task.assign`           | incident_commander       | Reason required                                          |
| Add comment                     | `task.comment`          | field_responder          | Must be participant (assignee, assigner, or incident)    |
| Read comments                   | `task.read`             | duty_operator            | Same as task read                                        |
| Add dependency                  | `task.update`           | incident_commander       |                                                           |
| Remove dependency               | `task.update`           | incident_commander       |                                                           |
| Bulk create from template       | `task.create`           | incident_commander (incident) / shift_lead (standalone) |             |
| Update position (drag-drop)     | `task.update`           | assignee or IC           |                                                           |
| View overdue tasks              | `task.read`             | shift_lead               | Dashboard-level visibility                               |
| View SLA-at-risk tasks          | `task.read`             | shift_lead               | Dashboard-level visibility                               |
| Manage templates                | `task.template.manage`  | shift_lead               |                                                           |
| View task board                 | `task.read`             | duty_operator            | Filtered by incident participation                       |
| View dependency graph           | `task.read`             | duty_operator            |                                                           |

### Role Hierarchy (Reference)

```
field_responder (1) < duty_operator (2) < incident_commander (3) < shift_lead (4) < tenant_admin (5) < super_admin (6)
```

### Incident Participation Enforcement

For incident-linked tasks, the task module verifies incident participation beyond the basic role check:

```typescript
// Pseudocode for incident participation check
const canAccessIncidentTask = async (user: User, task: Task): Promise<boolean> => {
  if (!task.incidentId) return true; // standalone task, role check is sufficient

  // shift_lead+ can see all tasks in their tenant
  if (user.roleLevel >= 4) return true;

  // Check if user is a participant of the incident
  const isParticipant = await incidentQueryService.isActiveParticipant(
    task.incidentId,
    user.id,
  );
  return isParticipant;
};
```

This is enforced at the application layer. The database RLS policy handles tenant isolation; incident participation filtering is done in the query builder.

---

## 9. Edge Cases

### SLA Breach Timer Fires After Task Completion

**Scenario:** A scheduled SLA check runs and finds a task whose `sla_breach_at` has passed, but the task was already completed before the breach time.
**Resolution:** The SLA check job filters on `status NOT IN ('done', 'cancelled')`. If the task was completed between the `sla_breach_at` time and the job execution, the job will not find it. Additionally, the `_sla_breach_emitted` metadata flag provides idempotency -- even if the job somehow processes the task, the event will not be emitted a second time. No manual intervention required.

### Assignee Removed from Incident While Task is IN_PROGRESS

**Scenario:** A participant is removed from an incident via `incident.participant_removed.v1`, but they have active tasks assigned to them.
**Resolution:** The task module consumes `incident.participant_removed.v1` and queries for all active tasks assigned to the removed user for that incident. It does NOT auto-reassign or auto-cancel. Instead:
1. Each affected task's metadata is flagged with `_assigneeRemovedFromIncident: true`
2. A notification is sent to the incident commander listing all affected tasks
3. The IC must manually reassign or cancel each task

```typescript
@EventHandler('incident.participant_removed.v1')
async handleParticipantRemoved(event: ParticipantRemovedEvent): Promise<void> {
  const { incidentId, userId } = event.data;

  const affectedTasks = await this.taskRepository.findByIncidentAndAssignee(
    incidentId,
    userId,
    { statusIn: ['todo', 'in_progress', 'blocked', 'review'] },
  );

  if (affectedTasks.length === 0) return;

  for (const task of affectedTasks) {
    task.metadata = { ...task.metadata, _assigneeRemovedFromIncident: true };
    await this.taskRepository.save(task);
  }

  const commanderId = await this.incidentQueryService.getCommanderId(incidentId);
  if (commanderId) {
    await this.notificationService.send(commanderId, {
      type: 'task_assignee_removed_from_incident',
      incidentId,
      affectedTaskIds: affectedTasks.map(t => t.id),
      removedUserId: userId,
      message: `${affectedTasks.length} task(s) are assigned to a user who was removed from the incident. Reassignment required.`,
    });
  }
}
```

### Bulk Template Creation Partially Fails

**Scenario:** A bulk creation from a template fails midway (e.g., one task has an invalid assignee override).
**Resolution:** The entire operation runs within a single database transaction. If any task creation fails, the entire transaction is rolled back -- zero tasks are created. The error response includes the specific template item ID and reason for failure. The client can fix the issue and retry.

```typescript
// Transaction boundary
await this.dataSource.transaction(async manager => {
  for (const item of templateItems) {
    const task = this.createTaskFromTemplateItem(item, params);
    await manager.save(task);
    // If this throws, the entire transaction rolls back
  }
});
```

### Dependency Target Task Gets Cancelled

**Scenario:** Task B depends on Task A. Task A is cancelled. Should Task B be automatically unblocked?
**Resolution:** This is tenant-configurable via `tenant.settings.task_auto_unblock_on_dependency_cancel`:

- **If enabled (default: false):** When Task A is cancelled and Task B is `BLOCKED`, Task B is automatically transitioned to `IN_PROGRESS`. A comment is added to Task B: "Automatically unblocked: dependency [Task A title] was cancelled." An event `task.status_changed.v1` is emitted.
- **If disabled:** Task B remains `BLOCKED`. A notification is sent to Task B's assignee: "Dependency [Task A title] was cancelled. Review whether this task can proceed."

```typescript
@EventHandler('task.status_changed.v1')
async handleDependencyCancelledCheck(event: TaskStatusChangedEvent): Promise<void> {
  if (event.data.after !== 'cancelled') return;

  const dependentTasks = await this.dependencyRepository.findDependentsOf(event.data.taskId);
  const tenantSettings = await this.tenantSettingsService.get(event.tenantId);

  for (const dep of dependentTasks) {
    const task = await this.taskRepository.findById(dep.taskId);
    if (!task || task.status !== TaskStatus.BLOCKED) continue;

    // Check if ALL remaining (non-cancelled) dependencies are done
    const remainingDeps = await this.dependencyRepository.findUpstream(task.id);
    const blockingDeps = remainingDeps.filter(d => {
      const depTask = /* loaded */ d;
      return depTask.status !== TaskStatus.DONE && depTask.status !== TaskStatus.CANCELLED;
    });

    if (blockingDeps.length > 0) continue; // still blocked by other dependencies

    if (tenantSettings.taskAutoUnblockOnDependencyCancel) {
      const events = task.transitionTo(TaskStatus.IN_PROGRESS, Actor.system(), {
        reason: `Auto-unblocked: dependency "${event.data.taskTitle}" was cancelled`,
      });
      await this.taskRepository.save(task);
      await this.outboxService.publishAll(events);
    } else {
      await this.notificationService.send(task.assigneeId, {
        type: 'dependency_cancelled',
        taskId: task.id,
        cancelledDependencyTitle: event.data.taskTitle,
        message: `Dependency "${event.data.taskTitle}" was cancelled. Review whether task "${task.title}" can proceed.`,
      });
    }
  }
}
```

### Concurrent Drag-Drop Reordering

**Scenario:** Two users simultaneously reorder tasks on the same board column. User A moves Task X to position 3. User B moves Task Y to position 3.
**Resolution:** Last-write-wins on the `position` column. No database-level locking is used for position updates (they are high-frequency, low-risk operations). The resolution strategy:

1. Each position update is a single `UPDATE task.tasks SET position = :newPosition WHERE id = :taskId` -- no reordering of other tasks.
2. The WebSocket broadcast includes the full board state after each position change.
3. If two updates conflict (both tasks end up at position 3), the client receives the corrected board state via WebSocket and re-renders.
4. The board query uses `ORDER BY position ASC, priority ASC, created_at ASC` as tiebreaker -- tasks with the same position are sorted by priority then creation time.

This approach prioritizes availability over strict ordering consistency. In practice, drag-drop conflicts are rare and self-correcting within one WebSocket broadcast cycle (~100ms).

### Task Assigned to User in Different Tenant

**Scenario:** An API call attempts to assign a task to a user whose `tenant_id` does not match the task's `tenant_id`.
**Resolution:** Rejected at the application layer before any database write. The handler loads the target user via IAM and verifies `user.tenantId === task.tenantId`. If they do not match, the request is rejected with HTTP 422 and a generic error message (not revealing that the user exists in another tenant). RLS provides defense-in-depth at the database layer.

### Task Created with incident_id Pointing to Closed Incident

**Scenario:** A race condition where an incident is closed between the validation check and the task insert.
**Resolution:** The `incident_id` FK constraint ensures the incident exists, but does not enforce incident status. The application validates incident status in the same transaction using `SELECT status FROM incident.incidents WHERE id = :incidentId FOR SHARE`. If the status is `closed` or `archived` at read time, the task creation is rejected. The `FOR SHARE` lock prevents the incident from being modified during the check.

### Comment on Deleted Task

**Scenario:** A user attempts to add a comment to a soft-deleted task (where `deleted_at IS NOT NULL`).
**Resolution:** The GetTask handler filters `deleted_at IS NULL`. If the task is soft-deleted, the handler returns `TASK_NOT_FOUND`. This applies uniformly to all operations -- a soft-deleted task is invisible to the API.

### SLA Set After Task Already Started

**Scenario:** A task is created without an SLA, starts, and later an SLA is set via UpdateTask.
**Resolution:** The SLA breach time can be set or updated at any time before the task reaches a terminal state (`done` or `cancelled`). If `sla_breach_at` is set to a time in the past, the SLA breach job will detect it on its next run and emit the breach event immediately. There is no `TASK_SLA_ALREADY_SET` error for updates -- that error code is reserved for cases where business rules prohibit changing an SLA (e.g., a tenant-level policy that SLA can only be set at creation time, if such a policy is configured).
