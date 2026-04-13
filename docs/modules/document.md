# Document Module -- Official Document Management & Approval Workflow

## 1. Purpose

The Document module manages the full lifecycle of official documents within the CoESCD disaster management platform. It handles creation, versioning, approval workflows, digital signatures, and publication of formal documents including orders, situation reports, evacuation plans, resource allocation directives, and post-incident reports.

Documents are the authoritative written record of decisions and directives during incident response. They carry classification levels, require approval chains with quorum-based policies, and support digital signatures for legal validity.

### Ownership Boundaries

Document **owns**:

- The full document lifecycle (draft through archived/revoked)
- Document versions (immutable content snapshots with SHA-256 integrity)
- Approval workflows (quorum-based, per-version approval chains)
- Digital signatures (TOTP and WebAuthn methods)
- Document templates (with placeholders for automated generation)
- Document generation from templates (including post-incident reports)
- Content integrity verification (SHA-256 hash on every read)

Document **does not own**:

- File storage (owned by the File module; document references files via `content_file_id` FK)
- Incidents (owned by the Incident module; linked via optional `incident_id` FK)
- User identity and permissions (owned by IAM; document queries IAM for authorization)
- Notifications (owned by the Notification module; document emits events that Notification consumes)
- Chat channels (owned by the Chat module; document may reference a discussion thread)
- Antivirus scanning (owned by the File module; document checks scan status before publish)

---

## 2. Domain Model

### Aggregates

#### Document (Aggregate Root)

| Column          | Type        | Notes                                                                        |
| --------------- | ----------- | ---------------------------------------------------------------------------- |
| id              | uuid (v7)   | PK                                                                           |
| tenant_id       | uuid        | FK -> iam.tenants, NOT NULL                                                  |
| incident_id     | uuid        | FK -> incident.incidents, nullable (null = standalone document)              |
| template_code   | text        | FK -> document.templates(code), nullable (null = freeform document)          |
| title           | text        | 3-500 chars, NOT NULL                                                        |
| classification  | smallint    | CHECK (classification BETWEEN 1 AND 4), NOT NULL, default 1                 |
| state           | text        | CHECK (state IN state list), NOT NULL, default 'draft'                       |
| current_version | integer     | NOT NULL, default 1, tracks the latest version number                        |
| owner_id        | uuid        | FK -> iam.users, NOT NULL (the author/owner who controls the document)       |
| created_at      | timestamptz | Default now()                                                                |
| updated_at      | timestamptz | Default now(), trigger-maintained                                            |

#### DocumentVersion (Entity)

| Column          | Type        | Notes                                                                        |
| --------------- | ----------- | ---------------------------------------------------------------------------- |
| id              | uuid (v7)   | PK                                                                           |
| document_id     | uuid        | FK -> document.documents, NOT NULL                                           |
| version         | integer     | NOT NULL, sequential starting at 1                                           |
| content_file_id | uuid        | FK -> file.files, NOT NULL (reference to the actual content file)            |
| hash_sha256     | text        | NOT NULL, hex-encoded SHA-256 of the content at time of version creation     |
| authored_by     | uuid        | FK -> iam.users, NOT NULL                                                    |
| authored_at     | timestamptz | NOT NULL, default now()                                                      |
| notes           | text        | Max 2000 chars, nullable (version change notes)                              |

Constraint: `UNIQUE (document_id, version)`

Immutability rule: Once a document reaches `APPROVED` state for a given version, that version's row (content_file_id, hash_sha256, authored_by, authored_at, notes) is frozen. Any further edits require creating a new version.

#### DocumentApproval (Entity)

| Column      | Type        | Notes                                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| id          | uuid (v7)   | PK                                                                           |
| document_id | uuid        | FK -> document.documents, NOT NULL                                           |
| version     | integer     | NOT NULL, the version number being approved                                  |
| approver_id | uuid        | FK -> iam.users, NOT NULL                                                    |
| decision    | text        | CHECK (decision IN ('pending','approved','rejected')), NOT NULL, default 'pending' |
| decided_at  | timestamptz | Nullable, set when decision changes from 'pending'                           |
| comment     | text        | Max 2000 chars, nullable (approval or rejection reason)                      |

Constraint: `UNIQUE (document_id, version, approver_id)` -- each approver decides once per version.

#### DocumentSignature (Entity)

| Column         | Type        | Notes                                                                        |
| -------------- | ----------- | ---------------------------------------------------------------------------- |
| id             | uuid (v7)   | PK                                                                           |
| document_id    | uuid        | FK -> document.documents, NOT NULL                                           |
| version        | integer     | NOT NULL, the version number being signed                                    |
| signer_id      | uuid        | FK -> iam.users, NOT NULL                                                    |
| method         | text        | CHECK (method IN ('totp','webauthn')), NOT NULL                              |
| signed_at      | timestamptz | NOT NULL, default now()                                                      |
| signature_data | jsonb       | NOT NULL, method-specific proof (TOTP: token hash; WebAuthn: assertion)      |

Constraint: `UNIQUE (document_id, version, signer_id)` -- each signer signs once per version.

#### DocumentTemplate (Entity)

| Column           | Type        | Notes                                                                      |
| ---------------- | ----------- | -------------------------------------------------------------------------- |
| code             | text        | PK, immutable, machine-readable identifier (e.g., 'post_incident_report') |
| tenant_id        | uuid        | FK -> iam.tenants, NOT NULL                                                |
| name             | text        | 3-200 chars, NOT NULL, human-readable display name                         |
| description      | text        | Max 2000 chars, nullable                                                   |
| content_template | text        | NOT NULL, the template body with placeholders                              |
| approval_policy  | jsonb       | NOT NULL, defines who must approve and sign                                |
| signature_policy | jsonb       | NOT NULL, defines who must sign and by what method                         |
| created_at       | timestamptz | Default now()                                                              |
| updated_at       | timestamptz | Default now(), trigger-maintained                                          |

Constraint: `UNIQUE (tenant_id, code)`

### Value Objects

**DocClass (Classification)**

```typescript
export enum DocClass {
  PUBLIC       = 1,  // visible to all authenticated users
  INTERNAL     = 2,  // requires clearance >= INTERNAL
  CONFIDENTIAL = 3,  // requires clearance >= CONFIDENTIAL
  SECRET       = 4,  // requires clearance >= SECRET
}
```

**LifecycleState**

```typescript
export enum LifecycleState {
  DRAFT     = 'draft',
  REVIEW    = 'review',
  APPROVED  = 'approved',
  PUBLISHED = 'published',
  ARCHIVED  = 'archived',
  REVOKED   = 'revoked',
}
```

**ApprovalPolicy**

```typescript
export interface ApprovalPolicy {
  approvals: ApprovalRequirement[];
  signatures: SignatureRequirement[];
}

export interface ApprovalRequirement {
  role: string;    // IAM role required (e.g., 'incident_commander', 'shift_lead')
  quorum: number;  // minimum number of approvers with this role required
}

export interface SignatureRequirement {
  role: string;    // IAM role required for the signer
  method: 'totp' | 'webauthn';  // required signing method
}
```

**Example ApprovalPolicy:**

```json
{
  "approvals": [
    { "role": "incident_commander", "quorum": 1 },
    { "role": "shift_lead", "quorum": 2 }
  ],
  "signatures": [
    { "role": "incident_commander", "method": "webauthn" },
    { "role": "shift_lead", "method": "totp" }
  ]
}
```

### State Machine

Every valid transition, its preconditions, and the required role:

```
 ┌───────┐
 │ draft │ ◄──── reject (any approver rejects → back to author)
 └──┬────┘
    │ submit_for_review (owner submits)
    ▼
 ┌────────┐
 │ review │
 └──┬──┬──┘
    │  │
    │  └──── reject → draft (approver rejects; clears all pending approvals for this version)
    │
    └──── approve (all approval quorums met + all signatures collected)
           │
           ▼
        ┌──────────┐
        │ approved │ (LOCKED — no edits allowed)
        └──┬──┬────┘
           │  │
           │  └──── archive (never published, superseded, or no longer needed)
           │         ▼
           │      ┌──────────┐
           │      │ archived │
           │      └──────────┘
           │
           └──── publish (explicit publish action)
                  │
                  ▼
               ┌───────────┐
               │ published │
               └──┬──┬─────┘
                  │  │
                  │  └──── revoke (writes tombstone version with reason)
                  │         ▼
                  │      ┌─────────┐
                  │      │ revoked │ (terminal — old versions accessible to auditors)
                  │      └─────────┘
                  │
                  └──── archive
                         ▼
                      ┌──────────┐
                      │ archived │
                      └──────────┘

Any state except REVOKED → NEW VERSION
  (creates new version, document resets to DRAFT;
   previous version remains in its state for audit)
```

**Transition table (exhaustive):**

| From      | To        | Transition Code    | Required Role                     | Preconditions                                                       |
| --------- | --------- | ------------------ | --------------------------------- | ------------------------------------------------------------------- |
| draft     | review    | submit_for_review  | owner                             | At least one version must exist                                     |
| review    | approved  | approve            | approval_policy roles             | All quorums met AND all required signatures collected               |
| review    | draft     | reject             | any designated approver           | Rejection reason required; clears all pending approvals for version |
| approved  | published | publish            | owner or tenant_admin             | Content file must pass AV scan (checked via File module)            |
| approved  | archived  | archive            | owner or tenant_admin             | None                                                                |
| published | revoked   | revoke             | tenant_admin+                     | Revocation reason required; writes tombstone version                |
| published | archived  | archive            | owner or tenant_admin             | None                                                                |

**Invalid transitions (explicitly rejected):**

- `draft -> approved` (must go through review first)
- `draft -> published` (must go through review and approved first)
- `review -> published` (must be approved first)
- `approved -> draft` (create a new version instead)
- `revoked -> any` (terminal state)
- `archived -> any` (terminal state, except new version creation which creates a version and resets to draft)

**Every transition MUST:**

1. Validate the transition is allowed from the current state
2. Check all preconditions
3. Emit the corresponding domain event via outbox
4. Update `updated_at` timestamp
5. For rejection: clear all pending approvals and signatures for the current version
6. For revocation: create a tombstone version with reason in notes

```typescript
// Domain layer enforcement
export class Document {
  transitionTo(target: LifecycleState, actor: Actor, params: TransitionParams): DomainEvent[] {
    const transition = TRANSITION_MAP.get(`${this.state}->${target}`);
    if (!transition) {
      throw new DocumentInvalidTransitionError(this.state, target);
    }
    transition.validate(this, actor, params);

    const before = this.state;
    this.state = target;
    this.updatedAt = new Date();

    const events: DomainEvent[] = [];

    switch (target) {
      case LifecycleState.REVIEW:
        events.push(new DocumentReviewRequestedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, version: this.currentVersion, ownerId: this.ownerId,
          actorId: actor.userId,
        }));
        break;

      case LifecycleState.APPROVED:
        events.push(new DocumentApprovedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, version: this.currentVersion, actorId: actor.userId,
        }));
        break;

      case LifecycleState.DRAFT:
        // Rejected back to draft
        events.push(new DocumentRejectedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, version: this.currentVersion,
          rejectedBy: actor.userId, reason: params.reason,
        }));
        break;

      case LifecycleState.PUBLISHED:
        events.push(new DocumentPublishedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, version: this.currentVersion,
          classification: this.classification, actorId: actor.userId,
        }));
        break;

      case LifecycleState.REVOKED:
        events.push(new DocumentRevokedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, version: this.currentVersion,
          revokedBy: actor.userId, reason: params.reason,
        }));
        break;

      case LifecycleState.ARCHIVED:
        events.push(new DocumentArchivedEvent({
          documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
          title: this.title, previousState: before, actorId: actor.userId,
        }));
        break;
    }

    return events;
  }

  addVersion(authoredBy: string, contentFileId: string, hashSha256: string, notes?: string): DomainEvent[] {
    if (this.state === LifecycleState.REVOKED) {
      throw new DocumentInvalidTransitionError(this.state, 'new_version');
    }

    this.currentVersion += 1;
    this.state = LifecycleState.DRAFT;
    this.updatedAt = new Date();

    return [
      new DocumentVersionAddedEvent({
        documentId: this.id, tenantId: this.tenantId, incidentId: this.incidentId,
        version: this.currentVersion, authoredBy, contentFileId, hashSha256,
      }),
    ];
  }
}
```

---

## 3. Business Rules

### Invariants

1. **Version immutability once approved**: A `DocumentVersion` row is immutable once the document reaches `APPROVED` state for that version. The `content_file_id`, `hash_sha256`, `authored_by`, `authored_at`, and `notes` fields cannot be modified. Any further edits require creating a new version (incrementing `current_version`). Attempts to modify an approved version return `DOCUMENT_VERSION_LOCKED`.

2. **Approval requires quorum**: A document cannot transition from `REVIEW` to `APPROVED` until all quorum requirements defined in the template's `approval_policy` are met. If the document has no template (`template_code IS NULL`), a default policy of one approval from the document owner's supervisor role is applied. The quorum check is performed atomically: `SELECT count(*) FROM document.approvals WHERE document_id = :id AND version = :v AND decision = 'approved' AND approver_role = :role >= :quorum` for each role in the policy.

3. **Signature requirements**: In addition to approval quorums, the template's `signature_policy` defines required digital signatures. A document cannot transition to `APPROVED` unless all required signatures are collected. Each signature requirement specifies a role and a method (TOTP or WebAuthn).

4. **Classification ratchet**: Classification can only be raised, never lowered. Attempts to lower classification are rejected with `DOCUMENT_CLASSIFICATION_DOWNGRADE_DENIED`. If a lower classification is needed, a new document must be created.

5. **Draft/review visibility restriction**: A document in `DRAFT` or `REVIEW` state is only visible to:
   - The document owner (`owner_id`)
   - Users designated as approvers for the current version
   - Users with `shift_lead` role or above
   This is enforced at both the RLS and application layers.

6. **Published is the only externally visible state**: Only documents in `PUBLISHED` state are visible to non-authors outside the approval chain. All other states require explicit authorization.

7. **Tombstone on revocation**: Revoking a published document does NOT delete any data. Instead, it:
   - Creates a new version (tombstone) with `notes` containing the revocation reason
   - Sets the document state to `REVOKED`
   - Previous versions remain accessible to users with `auditor` or `tenant_admin` role

8. **SHA-256 integrity verification**: On every read of a document version's content, the system recomputes the SHA-256 hash of the file content and compares it to the stored `hash_sha256`. If they do not match, the read is blocked, an audit event is emitted, and the system returns `DOCUMENT_INTEGRITY_VIOLATION`.

9. **Sequential version numbers**: Version numbers are sequential per document, starting at 1. They are never reused, even if a version is part of a rejected cycle. Creating a new version always increments `current_version` by exactly 1.

10. **Approval is per-version**: Each approval and signature is tied to a specific version number. If a document is rejected and a new version is created, all approvals and signatures from the previous version do not carry over.

11. **Template placeholder rendering**: Template placeholders use the format `{{field_name}}` with optional pipe filters: `{{field_name | filter}}`. Available placeholders:
    - `{{incident.code}}` -- incident code (e.g., "EQ-2026-04-0012")
    - `{{incident.title}}` -- incident title
    - `{{incident.severity | severityLabel}}` -- human-readable severity (e.g., "CRITICAL")
    - `{{incident.opened_at | datetime}}` -- formatted datetime
    - `{{author.full_name}}` -- document author's full name
    - `{{current_date}}` -- current date in locale format
    - If a referenced field is missing or null, the placeholder renders as `[MISSING: field_name]` and the document is flagged with `metadata._has_missing_placeholders = true` for review.

12. **Post-incident report auto-generation**: When an incident is closed (`incident.closed.v1`), the document module automatically generates a post-incident report from the tenant's `post_incident_report` template. The generated document starts in `DRAFT` state and is assigned to the incident commander as owner.

### Constraints

| Constraint                                    | Enforcement       |
| --------------------------------------------- | ----------------- |
| `(document_id, version)` unique               | UNIQUE index      |
| `(document_id, version, approver_id)` unique  | UNIQUE index      |
| `(document_id, version, signer_id)` unique    | UNIQUE index      |
| `(tenant_id, code)` unique for templates      | UNIQUE index      |
| `classification` between 1 and 4              | CHECK constraint  |
| `state` follows state machine                 | Domain layer      |
| `title` 3-500 chars                           | CHECK + app layer |
| `version.notes` max 2000 chars                | CHECK + app layer |
| `approval.comment` max 2000 chars             | CHECK + app layer |
| `template.content_template` max 100000 chars  | CHECK + app layer |
| Version immutability after APPROVED            | Domain layer      |
| Classification ratchet (no downgrades)         | Domain layer      |

### Validation Rules

```typescript
// Enforced at both DTO (class-validator) and domain entity level

// Title: 3-500 characters, no leading/trailing whitespace
title: string; // @Length(3, 500) @Trim()

// Classification: 1-4
classification: number; // @IsInt() @Min(1) @Max(4)

// Version notes: max 2000 characters
notes?: string; // @MaxLength(2000) @IsOptional()

// Approval comment: max 2000 characters
comment?: string; // @MaxLength(2000) @IsOptional()

// Revocation/rejection reason: 1-2000 characters, required
reason: string; // @Length(1, 2000)

// Template code: 1-100 characters, alphanumeric + underscores
code: string; // @Matches(/^[a-z][a-z0-9_]{0,99}$/)
```

---

## 4. Use Cases

### Commands

#### CreateDocument

**Actor:** incident_commander+ for incident-linked documents, shift_lead+ for standalone documents
**Input:** title, classification?, incident_id?, template_code?, content_file_id, notes?
**Flow:**

1. Validate all input fields
2. If `incident_id` is provided, verify the incident exists and is not `archived`
3. If `template_code` is provided, verify the template exists for this tenant
4. Compute SHA-256 hash of the content file (fetched from File module)
5. Set `state = draft`, `current_version = 1`, `owner_id = actor.userId`
6. Persist `Document` row
7. Persist `DocumentVersion` row (version 1) with content_file_id, hash, notes
8. Publish outbox message: `document.created.v1`
9. Return created document with version details

**Idempotency:** Supports `Idempotency-Key` header. If a duplicate key is received, return the previously created document without side effects.

#### CreateFromTemplate

**Actor:** incident_commander+ for incident-linked, shift_lead+ for standalone
**Input:** template_code, incident_id?, title_override?
**Flow:**

1. Load template by `code` and `tenant_id`
2. If `incident_id` is provided, load the incident for placeholder data
3. Render template content by replacing all placeholders with actual values
4. For any missing placeholder data, insert `[MISSING: field_name]` and flag metadata
5. Upload rendered content to File module, receive `content_file_id`
6. Compute SHA-256 of the rendered content
7. Execute CreateDocument flow with rendered content
8. Return created document

#### AddVersion

**Actor:** owner or shift_lead+
**Input:** document_id, content_file_id, notes?
**Flow:**

1. Load document with `FOR UPDATE` lock
2. Verify document state is NOT `revoked` (all other states allow new versions)
3. Compute SHA-256 hash of the new content file
4. Call `document.addVersion(...)` -- domain method increments `current_version`, resets state to `draft`
5. Persist new `DocumentVersion` row
6. Persist updated document
7. Publish `document.version_added.v1` via outbox
8. Return updated document with new version

#### SubmitForReview

**Actor:** owner
**Input:** document_id
**Flow:**

1. Load document with `FOR UPDATE` lock
2. Verify current state is `draft`
3. Verify at least one version exists
4. If document has a template, load the template's `approval_policy`
5. Create `DocumentApproval` rows for each required approver (status `pending`)
6. Call `document.transitionTo(REVIEW, actor, params)`
7. Persist document and approval rows
8. Publish `document.review_requested.v1` via outbox (consumed by Notification to alert approvers)

#### ApproveVersion

**Actor:** designated approver (role matches `approval_policy`)
**Input:** document_id, comment?
**Flow:**

1. Load document, verify state is `review`
2. Load actor's pending approval row for this document and current version
3. If no pending approval exists for this actor, reject with `DOCUMENT_APPROVAL_INCOMPLETE` (not a designated approver)
4. Set `decision = approved`, `decided_at = now()`, `comment`
5. Check if all quorum requirements are now met (aggregate count per role)
6. Check if all required signatures are collected
7. If all quorums met AND all signatures collected: call `document.transitionTo(APPROVED, ...)`
8. Persist approval and document
9. Publish `document.approved.v1` via outbox (if approved) or no state change event (if quorum not yet met)

#### RejectVersion

**Actor:** any designated approver
**Input:** document_id, reason (required)
**Flow:**

1. Load document, verify state is `review`
2. Load actor's pending approval row
3. Set `decision = rejected`, `decided_at = now()`, `comment = reason`
4. Clear all remaining pending approvals for this version (set `decision = 'rejected'`, `comment = 'Cleared due to rejection by [actor]'`)
5. Call `document.transitionTo(DRAFT, actor, { reason })`
6. Persist all changes
7. Publish `document.rejected.v1` via outbox

#### SignVersion

**Actor:** designated signer (role matches `signature_policy`)
**Input:** document_id, method ('totp' | 'webauthn'), signature_data
**Flow:**

1. Load document, verify state is `review`
2. Verify actor's role matches a signature requirement in the policy
3. Verify the method matches the required method for this role
4. Validate signature_data:
   - For TOTP: verify the token against the actor's TOTP secret (via IAM module)
   - For WebAuthn: verify the assertion against the actor's registered credentials (via IAM module)
5. Create `DocumentSignature` row
6. Check if all signature requirements are now met
7. If all signatures AND all approval quorums met: call `document.transitionTo(APPROVED, ...)`
8. Persist signature and document
9. Publish `document.signed.v1` via outbox

#### PublishDocument

**Actor:** owner or tenant_admin
**Input:** document_id
**Flow:**

1. Load document, verify state is `approved`
2. Load the current version's `content_file_id`
3. Query File module for AV scan status; if scan not passed, reject with `DOCUMENT_FILE_AV_FAILED`
4. Call `document.transitionTo(PUBLISHED, actor, {})`
5. Persist document
6. Publish `document.published.v1` via outbox (consumed by Incident module to create timeline entry)

#### RevokeDocument

**Actor:** tenant_admin+
**Input:** document_id, reason (required)
**Flow:**

1. Load document with `FOR UPDATE` lock, verify state is `published`
2. Create a tombstone version:
   - Increment `current_version`
   - Create `DocumentVersion` row with `notes = 'REVOKED: ' + reason`, `content_file_id` pointing to an empty tombstone file, `hash_sha256` of the tombstone content
3. Call `document.transitionTo(REVOKED, actor, { reason })`
4. Persist tombstone version and document
5. Publish `document.revoked.v1` via outbox

#### ArchiveDocument

**Actor:** owner or tenant_admin
**Input:** document_id
**Flow:**

1. Load document, verify state is `approved` or `published`
2. Call `document.transitionTo(ARCHIVED, actor, {})`
3. Persist document
4. Publish `document.archived.v1` via outbox

#### GeneratePostIncidentReport

**Actor:** system (triggered by event) or incident_commander+
**Input:** incident_id
**Flow:**

1. Load incident, verify it is in `closed` state
2. Load the tenant's `post_incident_report` template
3. If no template exists, log a warning and return (no-op)
4. Gather all incident data: timeline, sitreps, participant list, resource deployments, task summary
5. Render template with all gathered data
6. Upload rendered content to File module
7. Execute CreateDocument flow with `template_code = 'post_incident_report'`, `incident_id`, `owner_id = incident.commander_id`
8. Return created document

**Retry policy:** If generation fails (e.g., File module unavailable), the event is retried via NATS JetStream with exponential backoff (1s, 5s, 30s, 2m, 10m). After 5 failed attempts, the message is moved to the dead-letter queue (DLQ) and a notification is sent to tenant admins.

### Queries

#### ListDocuments

**Actor:** any authenticated user (filtered by classification and visibility rules)
**Parameters:** cursor, limit (max 100, default 25), filters (incident_id, state, owner_id, classification, template_code, created_after, created_before), sort (created_at_desc | created_at_asc | title_asc | title_desc | updated_at_desc)
**Implementation:**

- RLS automatically filters by `tenant_id`
- Classification filter: `classification <= user.clearance` (ABAC)
- Visibility filter: `state = 'published' OR owner_id = :userId OR :userId IN (SELECT approver_id FROM document.approvals WHERE document_id = d.id AND version = d.current_version) OR :userRoleLevel >= 4`
- Cursor-based pagination using `(created_at, id)` composite cursor
- Redis cache for common queries (invalidated on document change events)

#### GetDocument

**Actor:** any authenticated user (classification + visibility check)
**Returns:** Full document DTO including:
- All document fields
- Current version details (content_file_id, hash_sha256, authored_by, notes)
- Approval status summary: `{ required: ApprovalRequirement[], current: { role, approvedCount, quorum }[] }`
- Signature status summary: `{ required: SignatureRequirement[], collected: { signerRole, method, signedAt }[] }`
- Version count

#### GetVersion

**Actor:** same as document read
**Parameters:** document_id, version (integer)
**Returns:** Full DocumentVersion DTO with integrity-verified content.

**Implementation:**
1. Load version row
2. Fetch file content from File module
3. Compute SHA-256 of fetched content
4. Compare against stored `hash_sha256`; if mismatch, block access, emit audit event, return `DOCUMENT_INTEGRITY_VIOLATION`
5. Return version details

#### GetApprovalStatus

**Actor:** owner, approvers, or shift_lead+
**Parameters:** document_id
**Returns:** List of all approval rows for the current version, grouped by role, with quorum progress.

#### GetApprovalInbox

**Actor:** any user with pending approvals
**Parameters:** cursor, limit (max 100, default 25)
**Returns:** Documents where the requesting user has a pending approval or signature request.

**Implementation:**

```sql
SELECT d.id, d.title, d.state, d.current_version, d.classification,
       d.incident_id, d.owner_id, d.created_at, d.updated_at,
       a.decision, a.approver_id
FROM document.documents d
JOIN document.approvals a ON a.document_id = d.id AND a.version = d.current_version
WHERE a.approver_id = :currentUserId
  AND a.decision = 'pending'
  AND d.state = 'review'
  AND d.tenant_id = :tenantId
ORDER BY d.updated_at DESC;
```

#### ListTemplates

**Actor:** duty_operator+
**Parameters:** cursor, limit (max 100, default 25)
**Returns:** All templates for the current tenant.

#### CompareVersions

**Actor:** same as document read
**Parameters:** document_id, v1 (integer), v2 (integer)
**Returns:** Diff between two versions. The diff is computed by fetching both content files, extracting text, and producing a unified diff output.

**Implementation:**
1. Load both version rows, verify they belong to the same document
2. Verify integrity (SHA-256) of both versions
3. Fetch content from File module for both versions
4. Extract text content (if PDF, extract via text layer; if plain text, use directly)
5. Compute unified diff
6. Return diff result with metadata (v1 authored_by, v2 authored_by, timestamps)

#### GetDocumentHistory

**Actor:** same as document read
**Parameters:** document_id, cursor, limit (max 100, default 50)
**Returns:** Chronological list of all events that occurred on the document: version additions, approval decisions, signatures, state transitions. Assembled from versions, approvals, and signatures tables, ordered by timestamp.

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max, Length,
  MaxLength, IsUUID, IsObject, Matches,
} from 'class-validator';

// ── Enums ────────────────────────────────────────────────

export enum LifecycleState {
  DRAFT     = 'draft',
  REVIEW    = 'review',
  APPROVED  = 'approved',
  PUBLISHED = 'published',
  ARCHIVED  = 'archived',
  REVOKED   = 'revoked',
}

export enum SignatureMethod {
  TOTP    = 'totp',
  WEBAUTHN = 'webauthn',
}

export enum ApprovalDecision {
  PENDING  = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// ── Command DTOs ─────────────────────────────────────────

export class CreateDocumentDto {
  @IsString()
  @Length(3, 500)
  title: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  classification?: number; // defaults to 1 (PUBLIC)

  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,99}$/)
  templateCode?: string;

  @IsUUID()
  contentFileId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateFromTemplateDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,99}$/)
  templateCode: string;

  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 500)
  titleOverride?: string;
}

export class AddVersionDto {
  @IsUUID()
  contentFileId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ApproveVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RejectVersionDto {
  @IsString()
  @Length(1, 2000)
  reason: string;
}

export class SignVersionDto {
  @IsEnum(SignatureMethod)
  method: SignatureMethod;

  @IsObject()
  signatureData: Record<string, unknown>;
}

export class RevokeDocumentDto {
  @IsString()
  @Length(1, 2000)
  reason: string;
}

export class GeneratePostIncidentReportDto {
  @IsUUID()
  incidentId: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(3, 500)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  classification?: number;
}

// ── Query DTOs ───────────────────────────────────────────

export class ListDocumentsQueryDto {
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
  @IsEnum(LifecycleState)
  'filter[state]'?: string;

  @IsOptional()
  @IsUUID()
  'filter[owner_id]'?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  'filter[classification]'?: number;

  @IsOptional()
  @IsString()
  'filter[template_code]'?: string;

  @IsOptional()
  @IsString()
  'filter[created_after]'?: string; // ISO 8601

  @IsOptional()
  @IsString()
  'filter[created_before]'?: string; // ISO 8601

  @IsOptional()
  @IsEnum(['created_at_desc', 'created_at_asc', 'title_asc', 'title_desc', 'updated_at_desc'])
  sort?: string;
}

export class CompareVersionsQueryDto {
  @IsInt()
  @Min(1)
  v1: number;

  @IsInt()
  @Min(1)
  v2: number;
}

// ── Response DTOs ────────────────────────────────────────

export class DocumentDto {
  id: string;
  tenantId: string;
  incidentId: string | null;
  templateCode: string | null;
  title: string;
  classification: number;
  state: LifecycleState;
  currentVersion: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export class DocumentDetailDto extends DocumentDto {
  currentVersionDetail: DocumentVersionDto;
  approvalStatus: ApprovalStatusDto;
  signatureStatus: SignatureStatusDto;
  versionCount: number;
}

export class DocumentVersionDto {
  id: string;
  documentId: string;
  version: number;
  contentFileId: string;
  hashSha256: string;
  authoredBy: string;
  authoredAt: string;
  notes: string | null;
}

export class DocumentApprovalDto {
  id: string;
  documentId: string;
  version: number;
  approverId: string;
  decision: ApprovalDecision;
  decidedAt: string | null;
  comment: string | null;
}

export class DocumentSignatureDto {
  id: string;
  documentId: string;
  version: number;
  signerId: string;
  method: SignatureMethod;
  signedAt: string;
}

export class ApprovalStatusDto {
  required: ApprovalRequirementDto[];
  current: ApprovalProgressDto[];
  allQuorumsMet: boolean;
}

export class ApprovalRequirementDto {
  role: string;
  quorum: number;
}

export class ApprovalProgressDto {
  role: string;
  approvedCount: number;
  quorum: number;
  met: boolean;
}

export class SignatureStatusDto {
  required: SignatureRequirementDto[];
  collected: CollectedSignatureDto[];
  allSignaturesCollected: boolean;
}

export class SignatureRequirementDto {
  role: string;
  method: SignatureMethod;
}

export class CollectedSignatureDto {
  signerRole: string;
  method: SignatureMethod;
  signedAt: string;
}

export class DocumentTemplateDto {
  code: string;
  tenantId: string;
  name: string;
  description: string | null;
  approvalPolicy: Record<string, unknown>;
  signaturePolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class VersionDiffDto {
  documentId: string;
  v1: number;
  v2: number;
  v1AuthoredBy: string;
  v1AuthoredAt: string;
  v2AuthoredBy: string;
  v2AuthoredAt: string;
  diff: string; // unified diff format
}

export class DocumentHistoryEntryDto {
  timestamp: string;
  kind: 'version_added' | 'submitted_for_review' | 'approved' | 'rejected' | 'signed' | 'published' | 'revoked' | 'archived';
  actorId: string;
  version: number;
  detail: Record<string, unknown>;
}

export class ApprovalInboxItemDto extends DocumentDto {
  pendingAction: 'approve' | 'sign';
  requestedAt: string;
}
```

### Endpoints

```
POST   /api/v1/documents
  Body: CreateDocumentDto
  Headers: Idempotency-Key (optional, UUID)
  Response 201: { data: DocumentDetailDto }
  Errors: 400 (validation), 404 (incident/template not found)

GET    /api/v1/documents
  Query: cursor, limit (1-100, default 25),
         filter[incident_id], filter[state], filter[owner_id],
         filter[classification], filter[template_code],
         filter[created_after], filter[created_before],
         sort (created_at_desc | created_at_asc | title_asc | title_desc | updated_at_desc)
  Response 200: { data: DocumentDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/documents/:id
  Response 200: { data: DocumentDetailDto }
  Errors: 404 DOCUMENT_NOT_FOUND, 403 (classification or visibility)

PATCH  /api/v1/documents/:id
  Body: UpdateDocumentDto
  Response 200: { data: DocumentDto }
  Errors: 404, 403, 422 DOCUMENT_VERSION_LOCKED,
          422 DOCUMENT_CLASSIFICATION_DOWNGRADE_DENIED

POST   /api/v1/documents/:id/versions
  Body: AddVersionDto
  Response 201: { data: DocumentVersionDto }
  Errors: 404 DOCUMENT_NOT_FOUND,
          422 DOCUMENT_INVALID_TRANSITION (if revoked)

GET    /api/v1/documents/:id/versions/:v
  Response 200: { data: DocumentVersionDto }
  Errors: 404 DOCUMENT_NOT_FOUND,
          500 DOCUMENT_INTEGRITY_VIOLATION (hash mismatch)

POST   /api/v1/documents/:id/submit
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION

POST   /api/v1/documents/:id/approve
  Body: ApproveVersionDto
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION,
          403 (not a designated approver),
          422 DOCUMENT_APPROVAL_INCOMPLETE

POST   /api/v1/documents/:id/reject
  Body: RejectVersionDto
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION,
          403 (not a designated approver)

POST   /api/v1/documents/:id/sign
  Body: SignVersionDto
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION,
          422 DOCUMENT_SIGNATURE_REQUIRED (wrong method or role),
          403 (not a designated signer)

POST   /api/v1/documents/:id/publish
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION,
          422 DOCUMENT_APPROVAL_INCOMPLETE (not yet approved),
          422 DOCUMENT_ALREADY_PUBLISHED,
          422 DOCUMENT_FILE_AV_FAILED

POST   /api/v1/documents/:id/revoke
  Body: RevokeDocumentDto
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION,
          403 (requires tenant_admin+)

POST   /api/v1/documents/:id/archive
  Response 200: { data: DocumentDto }
  Errors: 422 DOCUMENT_INVALID_TRANSITION

GET    /api/v1/documents/:id/approvals
  Response 200: { data: DocumentApprovalDto[] }

GET    /api/v1/documents/:id/history
  Query: cursor, limit (1-100, default 50)
  Response 200: { data: DocumentHistoryEntryDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/documents/:id/compare
  Query: v1 (integer), v2 (integer)
  Response 200: { data: VersionDiffDto }
  Errors: 404 (version not found), 422 (v1 == v2)

GET    /api/v1/documents/inbox
  Query: cursor, limit (1-100, default 25)
  Response 200: { data: ApprovalInboxItemDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/documents/templates
  Query: cursor, limit (1-100, default 25)
  Response 200: { data: DocumentTemplateDto[], page: { nextCursor, prevCursor, limit, hasMore } }

POST   /api/v1/documents/generate
  Body: GeneratePostIncidentReportDto
  Response 201: { data: DocumentDetailDto }
  Errors: 404 (incident not found), 422 (incident not closed),
          404 (template not found for tenant)
```

### Error Codes

| Code                                       | HTTP | Description                                                                   |
| ------------------------------------------ | ---- | ----------------------------------------------------------------------------- |
| DOCUMENT_NOT_FOUND                         | 404  | Document does not exist or is not visible to the requesting user              |
| DOCUMENT_INVALID_TRANSITION                | 422  | Requested state transition is not valid from the current state                |
| DOCUMENT_VERSION_LOCKED                    | 422  | Version is locked (document is APPROVED or beyond); create a new version      |
| DOCUMENT_APPROVAL_INCOMPLETE               | 422  | Not all required approvals or signatures have been collected                  |
| DOCUMENT_SIGNATURE_REQUIRED                | 422  | A required signature is missing, or wrong method/role provided                |
| DOCUMENT_ALREADY_PUBLISHED                 | 422  | Document is already in PUBLISHED state                                        |
| DOCUMENT_CLASSIFICATION_DOWNGRADE_DENIED   | 422  | Classification can only be raised, never lowered                              |
| DOCUMENT_FILE_AV_FAILED                    | 422  | Content file has not passed antivirus scan; cannot publish                    |
| DOCUMENT_INTEGRITY_VIOLATION               | 500  | SHA-256 hash mismatch detected on content file; access blocked                |
| DOCUMENT_TEMPLATE_NOT_FOUND               | 404  | Specified template code does not exist for this tenant                        |
| DOCUMENT_VERSION_NOT_FOUND                 | 404  | Specified version number does not exist for this document                     |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes a standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "document.created.v1"
  source: string;      // "document-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### document.created.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000001",
  "type": "document.created.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000099",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "templateCode": "evacuation_order",
    "title": "Evacuation Order - Northern District",
    "classification": 2,
    "state": "draft",
    "version": 1,
    "ownerId": "019526a0-1000-7000-8000-000000000060",
    "contentFileId": "019526c0-1000-7000-8000-000000000020",
    "hashSha256": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
  }
}
```

#### document.version_added.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000002",
  "type": "document.version_added.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T14:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000100",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "version": 2,
    "previousVersion": 1,
    "authoredBy": "019526a0-1000-7000-8000-000000000060",
    "contentFileId": "019526c0-1000-7000-8000-000000000030",
    "hashSha256": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"
  }
}
```

#### document.review_requested.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000003",
  "type": "document.review_requested.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:30:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000101",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "ownerId": "019526a0-1000-7000-8000-000000000060",
    "approverIds": [
      "019526a0-1000-7000-8000-000000000051",
      "019526a0-1000-7000-8000-000000000052",
      "019526a0-1000-7000-8000-000000000053"
    ],
    "signerIds": [
      "019526a0-1000-7000-8000-000000000051"
    ],
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### document.approved.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000004",
  "type": "document.approved.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000102",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "classification": 2,
    "approvals": [
      { "approverId": "019526a0-1000-7000-8000-000000000051", "role": "incident_commander", "decidedAt": "2026-04-12T10:45:00.000Z" },
      { "approverId": "019526a0-1000-7000-8000-000000000052", "role": "shift_lead", "decidedAt": "2026-04-12T10:50:00.000Z" },
      { "approverId": "019526a0-1000-7000-8000-000000000053", "role": "shift_lead", "decidedAt": "2026-04-12T10:55:00.000Z" }
    ],
    "signatures": [
      { "signerId": "019526a0-1000-7000-8000-000000000051", "method": "webauthn", "signedAt": "2026-04-12T10:46:00.000Z" }
    ],
    "actorId": "019526a0-1000-7000-8000-000000000053"
  }
}
```

#### document.rejected.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000005",
  "type": "document.rejected.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:40:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000103",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "rejectedBy": "019526a0-1000-7000-8000-000000000052",
    "reason": "Section 3 references incorrect evacuation routes. Route B7 was closed due to bridge damage.",
    "ownerId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### document.signed.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000006",
  "type": "document.signed.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:46:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000104",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "signerId": "019526a0-1000-7000-8000-000000000051",
    "signerRole": "incident_commander",
    "method": "webauthn",
    "signedAt": "2026-04-12T10:46:00.000Z"
  }
}
```

#### document.published.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000007",
  "type": "document.published.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:15:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000105",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "classification": 2,
    "ownerId": "019526a0-1000-7000-8000-000000000060",
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

#### document.revoked.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000008",
  "type": "document.revoked.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000106",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "version": 1,
    "tombstoneVersion": 2,
    "revokedBy": "019526a0-1000-7000-8000-000000000051",
    "reason": "Evacuation order superseded by all-clear directive after structural assessment completed."
  }
}
```

#### document.archived.v1

```json
{
  "id": "019526c0-1000-7000-8000-000000000009",
  "type": "document.archived.v1",
  "source": "document-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-20T12:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000107",
  "data": {
    "documentId": "019526c0-1000-7000-8000-000000000010",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "title": "Evacuation Order - Northern District",
    "previousState": "published",
    "actorId": "019526a0-1000-7000-8000-000000000060"
  }
}
```

### Consumed Events

#### incident.closed.v1

**Source:** Incident module
**Handler:** Automatically generate a post-incident report from the tenant's template.

```typescript
@EventHandler('incident.closed.v1')
async handleIncidentClosed(event: IncidentClosedEvent): Promise<void> {
  const { incidentId, tenantId, code, actorId } = event.data;

  const template = await this.templateRepository.findByCode(tenantId, 'post_incident_report');
  if (!template) {
    this.logger.warn(`No post_incident_report template found for tenant ${tenantId}. Skipping auto-generation.`);
    return;
  }

  const incident = await this.incidentQueryService.getIncident(incidentId);
  if (!incident) {
    this.logger.error(`Incident ${incidentId} not found during post-incident report generation.`);
    return;
  }

  // Gather comprehensive incident data for the report
  const timeline = await this.incidentQueryService.getFullTimeline(incidentId);
  const sitreps = await this.incidentQueryService.getAllSitreps(incidentId);
  const participants = await this.incidentQueryService.getParticipants(incidentId);
  const taskSummary = await this.taskQueryService.getIncidentTaskSummary(incidentId);

  const templateData = {
    incident,
    timeline,
    sitreps,
    participants,
    taskSummary,
    author: await this.iamQueryService.getUser(incident.commanderId),
    current_date: new Date().toISOString(),
  };

  const renderedContent = this.templateRenderer.render(template.contentTemplate, templateData);
  const contentFile = await this.fileService.upload(renderedContent, {
    filename: `post-incident-report-${code}.pdf`,
    mimeType: 'application/pdf',
    tenantId,
  });

  const hashSha256 = this.hashService.sha256(renderedContent);

  await this.createDocumentUseCase.execute({
    title: `Post-Incident Report - ${code}`,
    classification: incident.classification,
    incidentId,
    templateCode: 'post_incident_report',
    contentFileId: contentFile.id,
    hashSha256,
    ownerId: incident.commanderId,
    tenantId,
  });
}
```

#### incident.created.v1

**Source:** Incident module
**Handler:** If the tenant has auto-document templates configured for the incident's category, create initial documents.

```typescript
@EventHandler('incident.created.v1')
async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
  const { incidentId, category, tenantId, createdBy } = event.data;

  const tenantSettings = await this.tenantSettingsService.get(tenantId);
  const templateCodes = tenantSettings.autoDocumentTemplateMap?.[category];
  if (!templateCodes || templateCodes.length === 0) return;

  for (const templateCode of templateCodes) {
    const template = await this.templateRepository.findByCode(tenantId, templateCode);
    if (!template) continue;

    try {
      await this.createFromTemplateUseCase.execute({
        templateCode,
        incidentId,
        actorId: createdBy,
        tenantId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to auto-create document from template ${templateCode} for incident ${incidentId}: ${error.message}`,
      );
      // Continue with remaining templates; do not block incident creation
    }
  }
}
```

#### iam.user.deactivated.v1

**Source:** IAM module
**Handler:** Find all documents where the deactivated user has a pending approval or is the owner with documents in review. Alert document owners and tenant admins for reassignment.

```typescript
@EventHandler('iam.user.deactivated.v1')
async handleUserDeactivated(event: UserDeactivatedEvent): Promise<void> {
  const { userId, tenantId } = event.data;

  // Find pending approvals by the deactivated user
  const pendingApprovals = await this.approvalRepository.findPendingByApprover(userId);

  for (const approval of pendingApprovals) {
    const document = await this.documentRepository.findById(approval.documentId);
    if (!document || document.state !== LifecycleState.REVIEW) continue;

    // Mark the approval as needing reassignment
    approval.decision = 'rejected';
    approval.comment = `Approver deactivated. Reassignment required.`;
    approval.decidedAt = new Date();
    await this.approvalRepository.save(approval);

    // Notify document owner
    await this.notificationService.send(document.ownerId, {
      type: 'document_approver_deactivated',
      documentId: document.id,
      documentTitle: document.title,
      deactivatedUserId: userId,
      message: `Approver for document "${document.title}" has been deactivated. The document has been returned to DRAFT. Please re-submit with updated approvers.`,
    });

    // Return document to draft state
    const events = document.transitionTo(LifecycleState.DRAFT, Actor.system(), {
      reason: `Approver ${userId} deactivated. Returned to draft for approver reassignment.`,
    });
    await this.documentRepository.save(document);
    await this.outboxService.publishAll(events);
  }

  // Handle documents owned by the deactivated user that are in active states
  const ownedDocuments = await this.documentRepository.findByOwnerId(userId, {
    stateIn: ['draft', 'review', 'approved'],
  });

  if (ownedDocuments.length > 0) {
    await this.notificationService.alertTenantAdmins(tenantId, {
      type: 'document_owner_deactivated',
      affectedDocumentIds: ownedDocuments.map(d => d.id),
      deactivatedUserId: userId,
      message: `${ownedDocuments.length} document(s) are owned by a deactivated user. Ownership transfer required.`,
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
CREATE SCHEMA IF NOT EXISTS document;

-- =============================================================================
-- documents (main table)
-- =============================================================================
CREATE TABLE document.documents (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    incident_id     uuid            REFERENCES incident.incidents(id),
    template_code   text,
    title           text            NOT NULL CHECK (char_length(title) BETWEEN 3 AND 500),
    classification  smallint        NOT NULL DEFAULT 1 CHECK (classification BETWEEN 1 AND 4),
    state           text            NOT NULL DEFAULT 'draft' CHECK (state IN (
                        'draft','review','approved','published','archived','revoked'
                    )),
    current_version integer         NOT NULL DEFAULT 1,
    owner_id        uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_documents_tenant_id ON document.documents (tenant_id);

-- Incident lookup (all documents for an incident)
CREATE INDEX idx_documents_incident_id ON document.documents (incident_id)
    WHERE incident_id IS NOT NULL;

-- Incident + state (for incident document listing and publish-gate checks)
CREATE INDEX idx_documents_incident_state ON document.documents (incident_id, state)
    WHERE incident_id IS NOT NULL;

-- Owner active documents (for "my documents" query)
CREATE INDEX idx_documents_owner_active ON document.documents (owner_id, state)
    WHERE state NOT IN ('archived', 'revoked');

-- State filtering
CREATE INDEX idx_documents_tenant_state ON document.documents (tenant_id, state);

-- Classification filtering
CREATE INDEX idx_documents_tenant_classification ON document.documents (tenant_id, classification);

-- Template code lookup
CREATE INDEX idx_documents_template_code ON document.documents (tenant_id, template_code)
    WHERE template_code IS NOT NULL;

-- Cursor-based pagination composite
CREATE INDEX idx_documents_cursor ON document.documents (tenant_id, created_at DESC, id DESC);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION document.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON document.documents
    FOR EACH ROW
    EXECUTE FUNCTION document.update_updated_at();

-- =============================================================================
-- versions
-- =============================================================================
CREATE TABLE document.versions (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid            NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
    version         integer         NOT NULL,
    content_file_id uuid            NOT NULL,
    hash_sha256     text            NOT NULL CHECK (char_length(hash_sha256) = 64),
    authored_by     uuid            NOT NULL REFERENCES iam.users(id),
    authored_at     timestamptz     NOT NULL DEFAULT now(),
    notes           text            CHECK (char_length(notes) <= 2000),
    UNIQUE (document_id, version)
);

-- Version lookup by document (ordered)
CREATE INDEX idx_versions_document_id ON document.versions (document_id, version DESC);

-- Content file reference lookup
CREATE INDEX idx_versions_content_file ON document.versions (content_file_id);

-- Author lookup
CREATE INDEX idx_versions_authored_by ON document.versions (authored_by);

-- =============================================================================
-- approvals
-- =============================================================================
CREATE TABLE document.approvals (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid            NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
    version     integer         NOT NULL,
    approver_id uuid            NOT NULL REFERENCES iam.users(id),
    decision    text            NOT NULL DEFAULT 'pending' CHECK (decision IN (
                    'pending','approved','rejected'
                )),
    decided_at  timestamptz,
    comment     text            CHECK (char_length(comment) <= 2000),
    UNIQUE (document_id, version, approver_id)
);

-- Pending approvals per document/version
CREATE INDEX idx_approvals_pending ON document.approvals (document_id, version)
    WHERE decision = 'pending';

-- Approver inbox query (all pending approvals for a user)
CREATE INDEX idx_approvals_approver_pending ON document.approvals (approver_id, decision)
    WHERE decision = 'pending';

-- Decision audit lookup
CREATE INDEX idx_approvals_decided ON document.approvals (document_id, version, decided_at DESC)
    WHERE decided_at IS NOT NULL;

-- =============================================================================
-- signatures
-- =============================================================================
CREATE TABLE document.signatures (
    id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    uuid            NOT NULL REFERENCES document.documents(id) ON DELETE CASCADE,
    version        integer         NOT NULL,
    signer_id      uuid            NOT NULL REFERENCES iam.users(id),
    method         text            NOT NULL CHECK (method IN ('totp','webauthn')),
    signed_at      timestamptz     NOT NULL DEFAULT now(),
    signature_data jsonb           NOT NULL,
    UNIQUE (document_id, version, signer_id)
);

-- Signatures per document/version
CREATE INDEX idx_signatures_document_version ON document.signatures (document_id, version);

-- Signer lookup
CREATE INDEX idx_signatures_signer ON document.signatures (signer_id);

-- =============================================================================
-- templates
-- =============================================================================
CREATE TABLE document.templates (
    code             text            NOT NULL,
    tenant_id        uuid            NOT NULL REFERENCES iam.tenants(id),
    name             text            NOT NULL CHECK (char_length(name) BETWEEN 3 AND 200),
    description      text            CHECK (char_length(description) <= 2000),
    content_template text            NOT NULL CHECK (char_length(content_template) <= 100000),
    approval_policy  jsonb           NOT NULL DEFAULT '{"approvals":[],"signatures":[]}',
    signature_policy jsonb           NOT NULL DEFAULT '{"signatures":[]}',
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (code, tenant_id)
);

-- Tenant template listing
CREATE INDEX idx_templates_tenant ON document.templates (tenant_id);

CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON document.templates
    FOR EACH ROW
    EXECUTE FUNCTION document.update_updated_at();

-- =============================================================================
-- outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE document.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'document',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_outbox_unpublished ON document.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Classification ratchet enforcement trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION document.enforce_classification_ratchet()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.classification < OLD.classification THEN
        RAISE EXCEPTION 'Classification can only be raised, not lowered (attempted % -> %)',
            OLD.classification, NEW.classification
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_classification_ratchet
    BEFORE UPDATE OF classification ON document.documents
    FOR EACH ROW
    EXECUTE FUNCTION document.enforce_classification_ratchet();

-- =============================================================================
-- Version immutability enforcement trigger
-- Prevents modification of version rows once document is in approved+ state
-- =============================================================================
CREATE OR REPLACE FUNCTION document.enforce_version_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_state text;
BEGIN
    SELECT state INTO v_state
    FROM document.documents
    WHERE id = OLD.document_id;

    IF v_state IN ('approved', 'published', 'revoked') THEN
        RAISE EXCEPTION 'Cannot modify version % of document % in state %',
            OLD.version, OLD.document_id, v_state
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_versions_immutability
    BEFORE UPDATE ON document.versions
    FOR EACH ROW
    EXECUTE FUNCTION document.enforce_version_immutability();

-- =============================================================================
-- Approval quorum check function
-- Returns TRUE if all quorum requirements in the policy are met
-- =============================================================================
CREATE OR REPLACE FUNCTION document.check_approval_quorum(
    p_document_id uuid,
    p_version     integer,
    p_policy      jsonb
) RETURNS boolean AS $$
DECLARE
    v_requirement jsonb;
    v_role        text;
    v_quorum      integer;
    v_approved    integer;
BEGIN
    FOR v_requirement IN SELECT * FROM jsonb_array_elements(p_policy->'approvals')
    LOOP
        v_role := v_requirement->>'role';
        v_quorum := (v_requirement->>'quorum')::integer;

        SELECT count(*) INTO v_approved
        FROM document.approvals a
        JOIN iam.user_roles ur ON ur.user_id = a.approver_id AND ur.role = v_role
        WHERE a.document_id = p_document_id
          AND a.version = p_version
          AND a.decision = 'approved';

        IF v_approved < v_quorum THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- Signature check function
-- Returns TRUE if all signature requirements in the policy are met
-- =============================================================================
CREATE OR REPLACE FUNCTION document.check_signatures(
    p_document_id uuid,
    p_version     integer,
    p_policy      jsonb
) RETURNS boolean AS $$
DECLARE
    v_requirement jsonb;
    v_role        text;
    v_method      text;
    v_count       integer;
BEGIN
    FOR v_requirement IN SELECT * FROM jsonb_array_elements(p_policy->'signatures')
    LOOP
        v_role := v_requirement->>'role';
        v_method := v_requirement->>'method';

        SELECT count(*) INTO v_count
        FROM document.signatures s
        JOIN iam.user_roles ur ON ur.user_id = s.signer_id AND ur.role = v_role
        WHERE s.document_id = p_document_id
          AND s.version = p_version
          AND s.method = v_method;

        IF v_count < 1 THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE document.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.templates ENABLE ROW LEVEL SECURITY;

-- Policy: documents visible to same tenant
CREATE POLICY tenant_isolation ON document.documents
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: classification filter (ABAC)
CREATE POLICY classification_filter ON document.documents
    FOR SELECT
    USING (
        classification <= current_setting('app.current_user_clearance')::smallint
    );

-- Policy: draft/review visibility (only owner, approvers, and shift_lead+ can see)
CREATE POLICY draft_review_visibility ON document.documents
    FOR SELECT
    USING (
        state IN ('published', 'approved', 'archived', 'revoked')
        OR owner_id = current_setting('app.current_user_id')::uuid
        OR current_setting('app.current_user_role_level')::smallint >= 4  -- shift_lead+
        OR EXISTS (
            SELECT 1 FROM document.approvals a
            WHERE a.document_id = id
              AND a.version = current_version
              AND a.approver_id = current_setting('app.current_user_id')::uuid
        )
    );

-- Policy: versions — accessible via document (inherit document policies through join)
CREATE POLICY tenant_isolation ON document.versions
    USING (
        EXISTS (
            SELECT 1 FROM document.documents d
            WHERE d.id = document_id
              AND d.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: approvals — same tenant via document join
CREATE POLICY tenant_isolation ON document.approvals
    USING (
        EXISTS (
            SELECT 1 FROM document.documents d
            WHERE d.id = document_id
              AND d.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: signatures — same tenant via document join
CREATE POLICY tenant_isolation ON document.signatures
    USING (
        EXISTS (
            SELECT 1 FROM document.documents d
            WHERE d.id = document_id
              AND d.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: templates — same tenant
CREATE POLICY tenant_isolation ON document.templates
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );
```

### Useful Queries

#### Approval inbox for a user

```sql
SELECT d.id, d.title, d.state, d.current_version, d.classification,
       d.incident_id, d.owner_id, d.created_at, d.updated_at,
       a.id AS approval_id, a.decision
FROM document.documents d
JOIN document.approvals a ON a.document_id = d.id AND a.version = d.current_version
WHERE a.approver_id = :userId
  AND a.decision = 'pending'
  AND d.state = 'review'
  AND d.tenant_id = :tenantId
ORDER BY d.updated_at DESC;
```

#### Documents pending signature for a user

```sql
SELECT d.id, d.title, d.state, d.current_version, d.classification
FROM document.documents d
WHERE d.state = 'review'
  AND d.tenant_id = :tenantId
  AND EXISTS (
      SELECT 1 FROM document.templates t
      WHERE t.code = d.template_code AND t.tenant_id = d.tenant_id
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(t.signature_policy->'signatures') AS req
          JOIN iam.user_roles ur ON ur.role = req->>'role' AND ur.user_id = :userId
          WHERE NOT EXISTS (
              SELECT 1 FROM document.signatures s
              WHERE s.document_id = d.id AND s.version = d.current_version AND s.signer_id = :userId
          )
      )
  )
ORDER BY d.updated_at DESC;
```

#### Document history (all events for a document, chronological)

```sql
WITH history AS (
    -- Version additions
    SELECT v.authored_at AS ts, 'version_added' AS kind,
           v.authored_by AS actor_id, v.version,
           jsonb_build_object('notes', v.notes, 'contentFileId', v.content_file_id) AS detail
    FROM document.versions v WHERE v.document_id = :documentId

    UNION ALL

    -- Approval decisions
    SELECT a.decided_at AS ts, a.decision AS kind,
           a.approver_id AS actor_id, a.version,
           jsonb_build_object('comment', a.comment) AS detail
    FROM document.approvals a
    WHERE a.document_id = :documentId AND a.decided_at IS NOT NULL

    UNION ALL

    -- Signatures
    SELECT s.signed_at AS ts, 'signed' AS kind,
           s.signer_id AS actor_id, s.version,
           jsonb_build_object('method', s.method) AS detail
    FROM document.signatures s WHERE s.document_id = :documentId
)
SELECT * FROM history
ORDER BY ts DESC, version DESC;
```

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The document module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Operation                      | Permission String            | Minimum Role             | Additional Conditions                                          |
| ------------------------------ | ---------------------------- | ------------------------ | -------------------------------------------------------------- |
| List documents                 | `document.read`              | duty_operator            | Filtered by classification + visibility rules                  |
| Get document detail            | `document.read`              | duty_operator            | Classification check via ABAC + visibility rules               |
| Get document version           | `document.read`              | duty_operator            | Same as document read; SHA-256 verified                        |
| Create incident-linked doc     | `document.create`            | incident_commander       | Must be IC or above of the linked incident                     |
| Create standalone document     | `document.create`            | shift_lead               |                                                                 |
| Create from template           | `document.create`            | incident_commander       | Same as create                                                  |
| Update document metadata       | `document.update`            | owner                    | Document not in approved/published/revoked state               |
| Add version                    | `document.update`            | owner or shift_lead+     | Document not revoked                                            |
| Submit for review              | `document.update.status`     | owner                    | Document must be in draft state                                |
| Approve version                | `document.approve`           | per approval_policy role | Must be a designated approver for this version                 |
| Reject version                 | `document.approve`           | per approval_policy role | Must be a designated approver; reason required                 |
| Sign version                   | `document.sign`              | per signature_policy role| Must match required role and method                            |
| Publish document               | `document.publish`           | owner or tenant_admin    | Document must be in approved state; AV scan passed             |
| Revoke document                | `document.revoke`            | tenant_admin             | Document must be in published state; reason required           |
| Archive document               | `document.update.status`     | owner or tenant_admin    | Document must be in approved or published state                |
| Generate post-incident report  | `document.create`            | incident_commander       | Incident must be closed                                         |
| Compare versions               | `document.read`              | duty_operator            | Same as document read                                          |
| View approval inbox            | `document.approve`           | per approval_policy      | Returns only documents where user has pending actions          |
| View templates                 | `document.read`              | duty_operator            |                                                                 |
| Manage templates               | `document.template.manage`   | tenant_admin             |                                                                 |
| Raise classification           | `document.classify`          | shift_lead               | Actor clearance >= target classification                       |
| View revoked document versions | `document.read.audit`        | auditor or tenant_admin  | Allows access to revoked document content                      |
| Delete document                | N/A                          | N/A                      | NEVER -- only archive or revoke                                |

### Role Hierarchy (Reference)

```
field_responder (1) < duty_operator (2) < incident_commander (3) < shift_lead (4) < tenant_admin (5) < super_admin (6)
```

### ABAC Classification Enforcement

The document module delegates classification-based access control to the IAM PDP. The PDP evaluates:

```typescript
// Pseudocode for classification ABAC policy
const canAccessDocument = (user: User, document: Document): boolean => {
  // User clearance must be >= document classification
  if (user.clearance < document.classification) return false;

  // Visibility check for non-published states
  if (!['published', 'archived'].includes(document.state)) {
    return (
      document.ownerId === user.id ||
      user.roleLevel >= 4 || // shift_lead+
      isDesignatedApprover(document, user)
    );
  }

  return true;
};
```

This is enforced at two levels:

1. **Database level:** RLS policies `classification_filter` and `draft_review_visibility` ensure queries never return documents above the user's clearance or outside their visibility scope
2. **Application level:** GetDocument handler performs an explicit check and returns `DOCUMENT_NOT_FOUND` (not 403) to avoid leaking the existence of classified documents

### Approval Role Resolution

When a document is submitted for review, the approval chain is determined by the template's `approval_policy`. The document module queries IAM to resolve which users satisfy each role requirement:

```typescript
async resolveApprovers(tenantId: string, policy: ApprovalPolicy, incidentId?: string): Promise<ResolvedApprover[]> {
  const approvers: ResolvedApprover[] = [];

  for (const req of policy.approvals) {
    const users = incidentId
      ? await this.iamService.getUsersByRoleInIncident(incidentId, req.role)
      : await this.iamService.getUsersByRoleInTenant(tenantId, req.role);

    for (const user of users) {
      approvers.push({ userId: user.id, role: req.role, quorum: req.quorum });
    }
  }

  return approvers;
}
```

---

## 9. Edge Cases

### Approver Deactivated While Approval is Pending

**Scenario:** A user who is a designated approver for a document in `REVIEW` state is deactivated via IAM.
**Resolution:** The `iam.user.deactivated.v1` event handler:
1. Finds all pending approvals by the deactivated user
2. Sets their decision to `rejected` with comment `Approver deactivated. Reassignment required.`
3. Returns the document to `DRAFT` state
4. Notifies the document owner with the list of affected documents
5. The owner must re-submit the document for review; new approvers are resolved from the template policy at that time

```typescript
// See iam.user.deactivated.v1 handler in Section 6 (Consumed Events)
```

### Concurrent Approvals on Same Version

**Scenario:** Two approvers approve the same document version simultaneously.
**Resolution:** Each approval is an independent row in `document.approvals` with a unique constraint on `(document_id, version, approver_id)`. Concurrent inserts/updates do not conflict. After each approval write, the quorum check runs atomically:

```sql
-- Within a transaction with FOR UPDATE on the document row
SELECT count(*) AS approved_count
FROM document.approvals
WHERE document_id = :id AND version = :v AND decision = 'approved';
```

The `FOR UPDATE` lock on the document row ensures that only one concurrent approval can trigger the state transition to `APPROVED`. The second transaction blocks until the first completes, then re-evaluates the quorum (and finds it already met, so no duplicate transition occurs).

### Template Placeholder References Missing Data

**Scenario:** A template uses `{{incident.severity | severityLabel}}` but the incident was created without a severity (impossible in current schema) or uses `{{incident.commander.full_name}}` but no commander is assigned yet.
**Resolution:**
1. The template renderer replaces the missing field with `[MISSING: field_name]`
2. The generated document metadata is flagged: `metadata._has_missing_placeholders = true`
3. During review, approvers see a warning banner indicating missing placeholder data
4. The missing placeholders do not block draft creation or review submission, but they should be resolved before approval

### Post-Incident Report Generation Fails

**Scenario:** The `incident.closed.v1` handler fails to generate the report (e.g., File module is unavailable, or the template rendering throws an error).
**Resolution:**
1. NATS JetStream automatically retries delivery with exponential backoff: 1s, 5s, 30s, 2m, 10m
2. Each retry attempt is logged with the error details
3. After 5 failed attempts, the message is moved to the dead-letter queue (DLQ) stream `document.dlq`
4. A notification is sent to tenant admins: `"Post-incident report generation failed for incident {code} after 5 attempts. Manual generation may be required."`
5. Tenant admins can manually trigger generation via `POST /api/v1/documents/generate`

### Document References a File That Fails AV Scan

**Scenario:** A document is in `APPROVED` state, and the owner attempts to publish it, but the referenced content file has been flagged by the antivirus scanner.
**Resolution:**
1. The PublishDocument handler queries the File module for the scan status of `content_file_id`
2. If the scan result is `infected` or `pending`, the publish is blocked with `DOCUMENT_FILE_AV_FAILED`
3. The document owner is notified: `"Document cannot be published: the content file has been flagged by the antivirus scanner. Please upload a clean version."`
4. The document remains in `APPROVED` state; the owner must add a new version with a clean file and go through the approval process again

### Version Hash Mismatch on Read

**Scenario:** A user requests a document version, and the SHA-256 hash of the retrieved file content does not match the stored `hash_sha256`.
**Resolution:**
1. The read is immediately blocked; no content is returned to the user
2. An audit event is emitted: `document.integrity_violation.v1` with the document ID, version, expected hash, and actual hash
3. The API returns HTTP 500 with error code `DOCUMENT_INTEGRITY_VIOLATION`
4. A high-priority notification is sent to tenant admins and the security team
5. The document is flagged in metadata: `metadata._integrity_violation = true`, `metadata._integrity_violation_at = <timestamp>`
6. Manual investigation is required; the flag prevents further reads until cleared by a super_admin

### Race Condition: Rejection Arrives After Final Approval

**Scenario:** Approver A is the final quorum vote. At nearly the same time, Approver B submits a rejection. Both requests arrive concurrently.
**Resolution:** Both handlers attempt to acquire a `FOR UPDATE` lock on the document row. Only one succeeds first:
- If the approval processes first: the document transitions to `APPROVED`. The rejection then finds the document is no longer in `REVIEW` and returns `DOCUMENT_INVALID_TRANSITION`.
- If the rejection processes first: the document transitions back to `DRAFT` and all pending approvals are cleared. The approval then finds the document is no longer in `REVIEW` and returns `DOCUMENT_INVALID_TRANSITION`.
Either outcome is consistent and safe.

### Incident Archived While Document is in Review

**Scenario:** An incident is archived, but there are documents linked to it still in `REVIEW` state.
**Resolution:** The document module does not consume `incident.archived.v1` for automatic document state changes. Documents in `REVIEW` remain in that state regardless of incident lifecycle. The rationale is that documents may have independent value even after the incident is archived (e.g., post-incident reports, formal orders that need to be preserved). Approvers can still complete the approval workflow.

### Owner Tries to Lower Classification After Approval

**Scenario:** A document is in `APPROVED` state with classification `CONFIDENTIAL` (3). The owner attempts to update it to `INTERNAL` (2).
**Resolution:** The classification ratchet is enforced at both the domain layer and the database trigger (`trg_documents_classification_ratchet`). The update is rejected with `DOCUMENT_CLASSIFICATION_DOWNGRADE_DENIED`. The only option is to create a new document at the lower classification level with new content.

### Bulk Template Auto-Creation for New Incident

**Scenario:** An incident is created for a category that has 5 auto-document templates configured. Two of them fail to render.
**Resolution:** Each template creation is attempted independently. Failures are logged but do not block the creation of other documents or the incident itself. The event handler continues processing remaining templates. Failed templates are logged with full error context. No retry is attempted for auto-creation failures (unlike post-incident reports) because the user can manually create documents from templates at any time.
