# IAM Module -- Identity & Access Management

## 1. Purpose

The IAM module is the central authority for identity, authentication, authorization, and tenant management within the Sentinel disaster management platform.

### Ownership Boundaries

IAM **owns**:

- All user identity and profile data
- Credentials (passwords, MFA factors, API keys)
- Roles, permissions, and ABAC policies
- Sessions and token lifecycle
- Tenant entities and hierarchy
- Groups for bulk role assignment
- The Policy Decision Point (PDP) for authorization queries
- Break-glass emergency access escalation

IAM **does not own**:

- Domain-specific access semantics (e.g., "who is the incident commander" belongs to the Incident module)
- Audit log storage (delegates to the Audit module; IAM emits events that Audit persists)
- UI session state or WebSocket connections (owned by the Realtime Gateway; IAM publishes revocation signals)

Every other module in the platform depends on IAM for authentication context (the JWT) and authorization decisions (the PDP).

---

## 2. Domain Model

### Aggregates

#### User (Aggregate Root)

| Column           | Type                  | Notes                                                        |
| ---------------- | --------------------- | ------------------------------------------------------------ |
| id               | uuid (v7)             | PK                                                           |
| tenant_id        | uuid                  | FK -> iam.tenants, NOT NULL                                  |
| email            | citext                | UNIQUE across all tenants (global namespace), max 254 chars  |
| phone            | text                  | E.164 format, nullable                                       |
| full_name        | text                  | 2-200 chars, no control characters                           |
| password_hash    | text                  | argon2id, nullable (null for SSO-only users)                 |
| clearance        | smallint              | 1=PUBLIC, 2=INTERNAL, 3=CONFIDENTIAL, 4=SECRET              |
| status           | text                  | CHECK (status IN ('active','disabled','locked','pending'))   |
| failed_attempts  | smallint              | Default 0, reset on successful login                         |
| last_login_at    | timestamptz           | Nullable                                                     |
| mfa_enabled      | boolean               | Default false, computed from verified MFA factors            |
| attributes       | jsonb                 | Extensible key-value store for ABAC                          |
| role_version     | integer               | Default 1, bumped on role changes for PDP cache invalidation |
| created_at       | timestamptz           | Default now()                                                |
| updated_at       | timestamptz           | Default now(), trigger-maintained                            |
| deleted_at       | timestamptz           | Nullable, soft delete                                        |

#### Tenant (Aggregate Root)

| Column     | Type        | Notes                                                  |
| ---------- | ----------- | ------------------------------------------------------ |
| id         | uuid (v7)   | PK                                                     |
| code       | text        | UNIQUE, alphanumeric + hyphen, 3-50 chars              |
| name       | text        | 2-200 chars                                            |
| region     | text        | ISO 3166-1 alpha-2 or sub-region code                  |
| parent_id  | uuid        | FK -> iam.tenants, nullable (self-ref for hierarchy)   |
| status     | text        | CHECK (status IN ('active','suspended','archived'))    |
| settings   | jsonb       | Tenant-level config (MFA policy, session limits, etc.) |
| created_at | timestamptz | Default now()                                          |
| updated_at | timestamptz | Default now()                                          |

#### Policy (Aggregate Root)

| Column     | Type        | Notes                                                       |
| ---------- | ----------- | ----------------------------------------------------------- |
| id         | uuid (v7)   | PK                                                          |
| tenant_id  | uuid        | FK -> iam.tenants, NOT NULL                                 |
| name       | text        | 2-200 chars                                                 |
| effect     | text        | CHECK (effect IN ('allow','deny'))                          |
| actions    | text[]      | Array of action patterns (e.g., 'incident.create')          |
| resources  | text[]      | Array of resource patterns (e.g., 'incident:*')             |
| condition  | jsonb       | ABAC condition predicates                                   |
| priority   | smallint    | Lower number = higher priority; deny wins at same priority  |
| version    | integer     | Default 1, incremented on each update                       |
| created_at | timestamptz | Default now()                                               |
| updated_at | timestamptz | Default now()                                               |
| deleted_at | timestamptz | Nullable, soft delete                                       |

### Entities

#### Role

| Column      | Type        | Notes                                                   |
| ----------- | ----------- | ------------------------------------------------------- |
| id          | uuid (v7)   | PK                                                      |
| tenant_id   | uuid        | FK -> iam.tenants, nullable (null = system-wide role)   |
| code        | text        | Alphanumeric + underscore, 3-50 chars                   |
| name        | text        | Human-readable display name                             |
| description | text        | Nullable                                                |
| is_system   | boolean     | Default false; system roles cannot be deleted by tenant  |
| created_at  | timestamptz | Default now()                                           |
| updated_at  | timestamptz | Default now()                                           |

Constraint: UNIQUE(tenant_id, code) with a partial unique index for null tenant_id.

#### Permission

| Column      | Type        | Notes                                                   |
| ----------- | ----------- | ------------------------------------------------------- |
| id          | uuid (v7)   | PK                                                      |
| code        | text        | UNIQUE, dot-separated segments, 3-100 chars             |
| description | text        | Human-readable description                              |
| created_at  | timestamptz | Default now()                                           |

#### Group

| Column      | Type        | Notes                                |
| ----------- | ----------- | ------------------------------------ |
| id          | uuid (v7)   | PK                                   |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL          |
| name        | text        | 2-200 chars                          |
| description | text        | Nullable                             |
| created_at  | timestamptz | Default now()                        |
| updated_at  | timestamptz | Default now()                        |

#### ApiKey

| Column       | Type        | Notes                                               |
| ------------ | ----------- | --------------------------------------------------- |
| id           | uuid (v7)   | PK                                                  |
| user_id      | uuid        | FK -> iam.users, NOT NULL                           |
| tenant_id    | uuid        | FK -> iam.tenants, NOT NULL                         |
| key_hash     | text        | SHA-256 hash of the raw key                         |
| name         | text        | Human-readable label                                |
| scopes       | text[]      | Subset of user's permissions at creation time       |
| expires_at   | timestamptz | Nullable (null = no expiry, but recommended)        |
| last_used_at | timestamptz | Nullable                                            |
| revoked_at   | timestamptz | Nullable                                            |
| created_at   | timestamptz | Default now()                                       |

#### Session

| Column       | Type        | Notes                                           |
| ------------ | ----------- | ----------------------------------------------- |
| id           | uuid (v7)   | PK                                              |
| user_id      | uuid        | FK -> iam.users, NOT NULL                       |
| refresh_hash | text        | SHA-256 hash of the opaque refresh token        |
| user_agent   | text        | Client user-agent string                        |
| ip           | inet        | Client IP address                               |
| created_at   | timestamptz | Default now()                                   |
| expires_at   | timestamptz | Absolute expiry (24h from creation)             |
| revoked_at   | timestamptz | Nullable; non-null means revoked                |
| rotated_at   | timestamptz | Nullable; set when refresh token was rotated    |

#### MfaFactor

| Column           | Type        | Notes                                            |
| ---------------- | ----------- | ------------------------------------------------ |
| id               | uuid (v7)   | PK                                               |
| user_id          | uuid        | FK -> iam.users, NOT NULL                        |
| type             | text        | CHECK (type IN ('totp','webauthn'))              |
| secret_encrypted | text        | AES-256-GCM encrypted secret (for TOTP)         |
| credential_id    | text        | WebAuthn credential ID (for webauthn), nullable  |
| public_key       | text        | WebAuthn public key (for webauthn), nullable     |
| verified_at      | timestamptz | Nullable; null means enrollment not yet verified |
| last_used_at     | timestamptz | Nullable                                         |
| created_at       | timestamptz | Default now()                                    |

### Value Objects

- **Email**: Validated against RFC 5322, lowercased, stored as `citext`, max 254 characters.
- **PhoneNumber**: E.164 format (`+` followed by 1-15 digits). Validated with regex `^\+[1-9]\d{1,14}$`.
- **PasswordHash**: Argon2id with parameters: memory=65536 KiB, iterations=3, parallelism=4, tag length=32 bytes.
- **Clearance**: Enum integer 1-4 mapping to PUBLIC (1), INTERNAL (2), CONFIDENTIAL (3), SECRET (4).

### Relationships

```
Tenant 1──* User           (user.tenant_id -> tenant.id)
Tenant 0..1──* Tenant      (tenant.parent_id -> tenant.id, self-referential hierarchy)
Tenant 1──* Role           (role.tenant_id -> tenant.id; null tenant_id = system role)
Tenant 1──* Policy         (policy.tenant_id -> tenant.id)
Tenant 1──* Group          (group.tenant_id -> tenant.id)

User *──* Role             (via iam.user_roles junction: user_id, role_id, scope, granted_by, granted_at, expires_at)
Role *──* Permission       (via iam.role_permissions junction: role_id, permission_id)
Group *──* User            (via iam.group_members junction: group_id, user_id, added_at, added_by)

User 1──* Session          (session.user_id -> user.id)
User 1──* MfaFactor        (mfa_factor.user_id -> user.id)
User 1──* ApiKey           (api_key.user_id -> user.id)
```

### Lifecycle State Machines

**User**: `pending` -> `active` -> `disabled` | `locked` -> (reactivate) -> `active`. Soft delete via `deleted_at`.

```
pending ──[verify email / admin activate]──> active
active  ──[admin deactivate]──────────────> disabled
active  ──[5 failed logins]───────────────> locked
disabled ──[admin reactivate]─────────────> active
locked  ──[admin unlock / auto 30min]────> active
any     ──[admin soft-delete]─────────────> deleted_at set (row retained)
```

**Session**: Created -> Active -> Expired | Revoked.

```
created ──[within TTL, not revoked]──> active (implicit)
active  ──[TTL exceeded]────────────> expired
active  ──[logout / admin revoke]──> revoked
active  ──[reuse detected]─────────> revoked (entire token family)
```

**Tenant**: `active` -> `suspended` -> `archived`.

```
active    ──[platform_admin suspend]──> suspended
suspended ──[platform_admin archive]──> archived
suspended ──[platform_admin reactivate]──> active
```

---

## 3. Business Rules

### Invariants

1. A User belongs to exactly one home Tenant (`tenant_id` FK) but can hold guest role assignments in other tenants via `user_roles.scope` containing a foreign `tenant_id`.
2. A User cannot escalate their own clearance. The `ChangeClearance` command requires `actor.clearance > target_new_clearance` and `actor.id != target.id`.
3. Deactivating a user invalidates ALL their sessions within 30 seconds. Implementation: set `revoked_at` on all session rows, then publish to Redis channel `iam:session:revoked:{user_id}`. The Realtime Gateway subscribes and disconnects sockets.
4. The `platform_admin` role can only be assigned by another `platform_admin` and requires 2-person approval (co-sign within 60 seconds via a separate endpoint).
5. A user cannot hold contradictory roles within the same scope. Contradictory pairs are defined in a system configuration table (e.g., `auditor` + `tenant_admin` in the same tenant).
6. Passwords must be >= 12 characters and must not appear in the HaveIBeenPwned breach database (checked via k-anonymity API: hash first 5 chars of SHA-1, query remote, compare locally).
7. MFA is mandatory for users with `clearance >= 3` and for users holding `platform_admin` or `tenant_admin` roles. Login flow blocks token issuance until MFA is verified.
8. Maximum 5 concurrent sessions per user. When a 6th session is created, the oldest active session is revoked.
9. API keys cannot have higher permissions (scopes) than the user who created them. Checked at creation time and re-validated on each API key authentication.
10. Tenant suspension cascades: all users under a suspended tenant lose active sessions within 30 seconds via Redis pub/sub broadcast.

### Constraints

| Constraint                   | Scope                  | Implementation                                      |
| ---------------------------- | ---------------------- | --------------------------------------------------- |
| email uniqueness             | Global (all tenants)   | UNIQUE index on `iam.users(email)` where `deleted_at IS NULL` |
| role code uniqueness         | Per tenant             | UNIQUE index on `iam.roles(tenant_id, code)`        |
| permission code uniqueness   | Global                 | UNIQUE index on `iam.permissions(code)`             |
| policy priority ordering     | Per tenant             | Lower number = higher priority; deny wins at same priority |
| user_role uniqueness         | Per user+role          | UNIQUE index on `iam.user_roles(user_id, role_id)` where `revoked_at IS NULL` |

### Validation Rules

| Field            | Rule                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| email            | Valid RFC 5322 email, citext, max 254 chars                                   |
| full_name        | 2-200 chars, no control characters (`/^[^\p{Cc}]{2,200}$/u`)                 |
| phone            | E.164 format or null (`/^\+[1-9]\d{1,14}$/`)                                 |
| clearance        | Integer 1-4                                                                   |
| password         | Min 12 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special char     |
| role code        | Alphanumeric + underscore, 3-50 chars (`/^[a-z][a-z0-9_]{2,49}$/`)           |
| permission code  | Dot-separated segments, 3-100 chars (`/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`) |
| tenant code      | Alphanumeric + hyphen, 3-50 chars (`/^[a-z][a-z0-9-]{2,49}$/`)               |

---

## 4. Use Cases (Application Layer)

### Commands

#### LoginUser

- **Input**: `{ email: string, password: string }`
- **Flow**: Find user by email -> verify status (active) -> verify tenant status (active) -> verify password (argon2id) -> check MFA enrollment -> if MFA required: generate challenge token (JWT, 5min TTL) and return `{ mfaRequired: true, challengeToken, mfaType }`; if no MFA: issue access+refresh tokens, create session, emit `iam.session.opened.v1`.
- **Error codes**: `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_LOCKED`, `AUTH_ACCOUNT_DISABLED`, `IAM_TENANT_SUSPENDED`

#### VerifyMfa

- **Input**: `{ challengeToken: string, code?: string, assertion?: object }`
- **Flow**: Decode challenge token -> validate not expired -> verify TOTP code (1-step drift tolerance) or WebAuthn assertion -> issue access+refresh tokens, create session, emit `iam.session.opened.v1`.
- **Error codes**: `AUTH_MFA_INVALID`, `AUTH_MFA_EXPIRED`

#### RefreshToken

- **Input**: `{ refreshToken: string }`
- **Flow**: Hash token with SHA-256 -> find session by `refresh_hash` -> verify not revoked and not expired -> verify `created_at` + 24h not exceeded (absolute timeout) -> rotate: mark old session as `rotated_at = now()`, create new session with new refresh hash -> issue new access+refresh tokens.
- **Reuse detection**: If the presented refresh hash matches a session where `rotated_at IS NOT NULL`, this is a reuse attack. Revoke ALL sessions for the user. Emit `iam.session.closed.v1` with reason `reuse_detected`.
- **Error codes**: `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_REUSE_DETECTED`

#### LogoutUser

- **Input**: `{ sessionId: string }` (extracted from JWT `sid` claim)
- **Flow**: Set `revoked_at = now()` on session -> publish to Redis `iam:session:revoked:{user_id}` -> emit `iam.session.closed.v1` with reason `logout`.

#### CreateUser

- **Input**: `CreateUserDto`
- **Flow**: Validate email uniqueness -> validate tenant exists and is active -> hash password with argon2id -> insert user with status `pending` or `active` (depending on tenant settings) -> emit `iam.user.created.v1`.
- **Authorization**: Requires `admin.user.manage` permission scoped to target tenant.
- **Error codes**: `IAM_USER_ALREADY_EXISTS`, `IAM_PERMISSION_DENIED`

#### UpdateUser

- **Input**: `UpdateUserDto` (profile fields only: full_name, phone, attributes)
- **Flow**: Validate fields -> update user -> emit `iam.user.updated.v1` with change diff.
- **Note**: Does not allow changing clearance or roles (separate commands).

#### DeactivateUser

- **Input**: `{ userId: string, reason: string }`
- **Flow**: Set `status = 'disabled'` -> revoke all active sessions -> publish Redis revocation -> emit `iam.user.deactivated.v1`.
- **Authorization**: Requires `admin.user.manage`. Cannot deactivate self.

#### AssignRole

- **Input**: `{ userId: string, roleId: string, scope?: object, expiresAt?: string }`
- **Flow**: Validate actor has `admin.role.manage` -> validate target user and role exist -> if role is `platform_admin`: require co-sign flow -> check for role conflicts -> insert `user_roles` row -> bump user `role_version` in DB and Redis -> emit `iam.role.assigned.v1` -> if `expiresAt` set: schedule NATS delayed message for auto-revocation.

#### RevokeRole

- **Input**: `{ userId: string, roleId: string }`
- **Flow**: Remove `user_roles` row (or set `revoked_at`) -> bump `role_version` -> emit `iam.role.revoked.v1`.

#### ChangeClearance

- **Input**: `{ targetUserId: string, newClearance: 1|2|3|4, reason: string }`
- **Flow**: Validate `actor.clearance > newClearance` -> validate `actor.id != targetUserId` -> update clearance -> emit `iam.clearance.changed.v1` -> if clearance was lowered: re-evaluate all active sessions (revoke any that now access resources above new clearance).

#### EnrollMfa

- **Input**: `{ userId: string, type: 'totp' | 'webauthn' }`
- **Flow**: Generate TOTP secret (20 bytes, encrypted with AES-256-GCM) or WebAuthn registration challenge -> insert `mfa_factors` row with `verified_at = null` -> return provisioning URI (for TOTP) or challenge (for WebAuthn).

#### VerifyMfaEnrollment

- **Input**: `{ userId: string, factorId: string, code?: string, assertion?: object }`
- **Flow**: Verify TOTP code or WebAuthn attestation -> set `verified_at = now()` -> set `user.mfa_enabled = true` -> emit `iam.mfa.enrolled.v1`.

#### CreatePolicy

- **Input**: `CreatePolicyDto`
- **Flow**: Validate JSON schema of condition -> validate action and resource patterns -> insert policy -> bump global `policy_version` counter in Redis -> emit `iam.policy.changed.v1` with action `created`.

#### UpdatePolicy

- **Input**: `UpdatePolicyDto`
- **Flow**: Same validation as create -> update row -> increment `policy.version` -> bump global `policy_version` -> emit `iam.policy.changed.v1` with action `updated`.

#### DeletePolicy

- **Input**: `{ policyId: string }`
- **Flow**: Set `deleted_at = now()` -> bump `policy_version` -> emit `iam.policy.changed.v1` with action `deleted`.

#### ActivateBreakGlass

- **Input**: `{ reason: string, targetResource: string, targetRole: string }`
- **Flow**: Require MFA verification -> create pending activation record -> require co-sign from a supervisor within 60 seconds (via `POST /breakglass/:activationId/cosign`) -> on co-sign: grant temporary elevated role (4h TTL) with scope limited to `targetResource` -> emit `iam.breakglass.activated.v1` -> schedule NATS delayed message for auto-expiry -> set red banner flag in user's session metadata.
- **Error codes**: `IAM_BREAKGLASS_COSIGN_TIMEOUT`, `IAM_BREAKGLASS_DENIED`, `IAM_MFA_REQUIRED`

#### CreateTenant

- **Input**: `CreateTenantDto`
- **Flow**: Validate code uniqueness -> validate parent exists if specified -> insert tenant -> emit `iam.tenant.created.v1`.
- **Authorization**: Requires `platform_admin` role.

#### SuspendTenant

- **Input**: `{ tenantId: string, reason: string }`
- **Flow**: Set `status = 'suspended'` -> revoke all sessions for all users in tenant -> publish Redis broadcast -> emit `iam.tenant.suspended.v1`.

### Queries

#### GetMe

Returns the current user's profile, roles, effective permissions, and tenant info. Assembled from the JWT claims plus a single cache-backed DB query for the full profile.

#### ListUsers

Paginated, cursor-based. Filterable by `tenant_id`, `status`, `role`, `clearance`, `search` (trigram match on email/full_name). Returns `UserDto[]` with pagination metadata.

#### GetUser

By ID. Returns `UserDetailDto` including roles, groups, recent session summary (count of active sessions, last login). Restricted by tenant scope unless actor is `platform_admin`.

#### ListRoles

By tenant. Includes system roles (where `tenant_id IS NULL`). Returns `RoleDto[]` with permission counts.

#### GetRole

By ID. Returns `RoleDetailDto` with full permission list.

#### ListPermissions

All system permissions. Returns `PermissionDto[]`. Not tenant-scoped.

#### ListPolicies

By tenant. Returns `PolicyDto[]`. Supports cursor pagination.

#### ListSessions

By user ID. Filterable by active-only (`revoked_at IS NULL AND expires_at > now()`). Returns `SessionDto[]`.

#### ListAuditLog

Delegates to the Audit module's query interface. Filters: actor, action, resource type, resource ID, time range. Returns paginated audit entries.

#### GetAvailableTransitions

Given a context (user, current state), returns which state transitions are available (for break-glass, role assignment approval flows).

#### CheckPermission (PDP)

Internal in-process call. Input: `{ subject, action, resource }`. Output: `{ decision: 'allow' | 'deny', obligations: string[] }`. See Section 14 for full evaluation flow.

---

## 5. API Contracts

### Auth Endpoints (No JWT Required)

#### POST /api/v1/auth/login

```
Request Body:
{
  "email": "string",
  "password": "string"
}

Response 200 (no MFA):
{
  "accessToken": "string (JWT)",
  "refreshToken": "string (opaque)",
  "mfaRequired": false
}

Response 200 (MFA required):
{
  "challengeToken": "string (JWT, 5min TTL)",
  "mfaRequired": true,
  "mfaType": "totp" | "webauthn"
}

Error Responses:
  401: { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password" }
  403: { code: "AUTH_ACCOUNT_LOCKED", message: "Account is locked due to too many failed attempts" }
  403: { code: "AUTH_ACCOUNT_DISABLED", message: "Account has been disabled" }
  403: { code: "IAM_TENANT_SUSPENDED", message: "Tenant is suspended" }
```

#### POST /api/v1/auth/mfa/verify

```
Request Body:
{
  "challengeToken": "string",
  "code": "string (6-digit TOTP, optional)",
  "assertion": "object (WebAuthn assertion, optional)"
}

Response 200:
{
  "accessToken": "string",
  "refreshToken": "string"
}

Error Responses:
  401: { code: "AUTH_MFA_INVALID", message: "Invalid MFA code or assertion" }
  401: { code: "AUTH_MFA_EXPIRED", message: "MFA challenge has expired" }
```

#### POST /api/v1/auth/refresh

```
Request Body:
{
  "refreshToken": "string"
}

Response 200:
{
  "accessToken": "string",
  "refreshToken": "string"
}

Error Responses:
  401: { code: "AUTH_REFRESH_INVALID", message: "Refresh token is invalid or expired" }
  401: { code: "AUTH_REFRESH_REUSE_DETECTED", message: "Refresh token reuse detected; all sessions revoked" }
```

#### POST /api/v1/auth/logout

```
Headers: Authorization: Bearer <jwt>

Response 204 (no body)
```

#### GET /api/v1/auth/me

```
Headers: Authorization: Bearer <jwt>

Response 200:
{
  "user": UserDto,
  "roles": RoleDto[],
  "permissions": ["string"],
  "tenant": TenantDto
}
```

#### GET /api/v1/.well-known/jwks.json

```
Response 200:
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "string",
      "use": "sig",
      "alg": "RS256",
      "n": "string (base64url)",
      "e": "string (base64url)"
    }
  ]
}
```

### User Management Endpoints (JWT Required)

#### GET /api/v1/users

```
Query Parameters:
  cursor: string (opaque cursor for pagination)
  limit: number (1-100, default 25)
  filter[tenant_id]: uuid
  filter[status]: "active" | "disabled" | "locked" | "pending"
  filter[role]: string (role code)
  filter[clearance]: 1 | 2 | 3 | 4
  filter[search]: string (trigram search on email/name)
  sort: "created_at" | "-created_at" | "full_name" | "-full_name" | "email" | "-email"

Response 200:
{
  "data": UserDto[],
  "page": {
    "nextCursor": "string | null",
    "prevCursor": "string | null",
    "limit": 25,
    "hasMore": true
  }
}
```

#### POST /api/v1/users

```
Request Body: CreateUserDto

Response 201:
{
  "data": UserDto
}
```

#### GET /api/v1/users/:id

```
Response 200:
{
  "data": UserDetailDto
}

Error Responses:
  404: { code: "IAM_USER_NOT_FOUND" }
```

#### PATCH /api/v1/users/:id

```
Request Body: UpdateUserDto

Response 200:
{
  "data": UserDto
}
```

#### POST /api/v1/users/:id/deactivate

```
Request Body:
{
  "reason": "string"
}

Response 200:
{
  "data": UserDto
}
```

#### POST /api/v1/users/:id/roles

```
Request Body:
{
  "roleId": "uuid",
  "scope": { "tenant_id": "uuid", ... } (optional),
  "expiresAt": "ISO 8601 datetime (optional)"
}

Response 201 (no body)
```

#### DELETE /api/v1/users/:id/roles/:roleId

```
Response 204 (no body)
```

#### POST /api/v1/users/:id/clearance

```
Request Body:
{
  "clearance": 1 | 2 | 3 | 4,
  "reason": "string"
}

Response 200
```

#### POST /api/v1/users/:id/mfa/enroll

```
Request Body:
{
  "type": "totp" | "webauthn"
}

Response 200 (TOTP):
{
  "factorId": "uuid",
  "provisioningUri": "otpauth://totp/Sentinel:user@example.com?secret=...&issuer=Sentinel"
}

Response 200 (WebAuthn):
{
  "factorId": "uuid",
  "challenge": { /* WebAuthn PublicKeyCredentialCreationOptions */ }
}
```

#### POST /api/v1/users/:id/mfa/verify

```
Request Body:
{
  "factorId": "uuid",
  "code": "string (6-digit, for TOTP)",
  "assertion": "object (for WebAuthn)"
}

Response 200
```

#### GET /api/v1/users/:id/sessions

```
Response 200:
{
  "data": SessionDto[]
}
```

#### DELETE /api/v1/users/:id/sessions/:sessionId

```
Response 204 (no body)
```

### Role & Permission Endpoints

```
GET    /api/v1/roles?filter[tenant_id]=<uuid>
POST   /api/v1/roles
GET    /api/v1/roles/:id
PATCH  /api/v1/roles/:id
DELETE /api/v1/roles/:id
GET    /api/v1/permissions
```

All role endpoints require `admin.role.manage` permission. System roles (`is_system = true`) cannot be modified or deleted by tenant admins.

### Policy Endpoints

```
GET    /api/v1/policies?filter[tenant_id]=<uuid>
POST   /api/v1/policies
GET    /api/v1/policies/:id
PATCH  /api/v1/policies/:id
DELETE /api/v1/policies/:id
POST   /api/v1/policies/evaluate
```

The `/evaluate` endpoint is for internal testing and debugging. It accepts a policy context and returns the evaluation result without side effects.

```
POST /api/v1/policies/evaluate
Request Body:
{
  "subject": { "id": "uuid", "tenant_id": "uuid", "clearance": 3, "roles": ["shift_lead"] },
  "action": "incident.create",
  "resource": { "type": "incident", "id": "uuid", "tenant_id": "uuid", "classification": 2 }
}

Response 200:
{
  "decision": "allow" | "deny",
  "matchedPolicies": [{ "id": "uuid", "name": "string", "effect": "allow" | "deny" }],
  "obligations": ["log_access"]
}
```

### Tenant Endpoints

```
GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:id
PATCH  /api/v1/tenants/:id
POST   /api/v1/tenants/:id/suspend
POST   /api/v1/tenants/:id/reactivate
```

All tenant management endpoints require `platform_admin` role except `GET /tenants/:id` which is available to `tenant_admin` of their own tenant.

### Break-Glass Endpoints

#### POST /api/v1/breakglass/activate

```
Request Body:
{
  "reason": "string (min 20 chars, explanation for emergency access)",
  "targetResource": "string (resource pattern, e.g. 'incident:uuid')",
  "targetRole": "string (role code to temporarily assume)"
}

Response 200:
{
  "activationId": "uuid",
  "expiresAt": "ISO 8601 (4 hours from co-sign)",
  "coSignRequired": true,
  "coSignDeadline": "ISO 8601 (60 seconds from now)"
}
```

#### POST /api/v1/breakglass/:activationId/cosign

```
Request Body:
{
  "supervisorId": "uuid",
  "mfaCode": "string"
}

Response 200:
{
  "activated": true,
  "expiresAt": "ISO 8601",
  "elevatedRole": "string",
  "targetResource": "string"
}

Error Responses:
  408: { code: "IAM_BREAKGLASS_COSIGN_TIMEOUT", message: "Co-sign window has expired" }
  403: { code: "IAM_BREAKGLASS_DENIED", message: "Supervisor does not have authority to co-sign" }
```

### DTOs (class-validator)

```typescript
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
  IsArray,
  IsObject,
  IsDateString,
  IsBoolean,
  MaxLength,
} from 'class-validator';

// ─── Auth DTOs ───────────────────────────────────────────────

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  challengeToken: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;

  @IsOptional()
  @IsObject()
  assertion?: Record<string, unknown>;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// ─── User DTOs ───────────────────────────────────────────────

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(2, 200)
  @Matches(/^[^\p{Cc}]+$/u, { message: 'full_name must not contain control characters' })
  fullName: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'phone must be in E.164 format' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{12,}$/, {
    message:
      'Password must contain at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
  })
  password?: string;

  @IsUUID()
  tenantId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  clearance?: number;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(/^[^\p{Cc}]+$/u, { message: 'full_name must not contain control characters' })
  fullName?: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'phone must be in E.164 format' })
  phone?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class DeactivateUserDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AssignRoleDto {
  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ChangeClearanceDto {
  @IsInt()
  @Min(1)
  @Max(4)
  clearance: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class EnrollMfaDto {
  @IsEnum(['totp', 'webauthn'])
  type: 'totp' | 'webauthn';
}

export class VerifyMfaEnrollmentDto {
  @IsUUID()
  factorId: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;

  @IsOptional()
  @IsObject()
  assertion?: Record<string, unknown>;
}

// ─── Role DTOs ───────────────────────────────────────────────

export class CreateRoleDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,49}$/, {
    message: 'code must be lowercase alphanumeric + underscore, 3-50 chars',
  })
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsUUID('all', { each: true })
  permissionIds: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}

// ─── Policy DTOs ─────────────────────────────────────────────

export class CreatePolicyDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsEnum(['allow', 'deny'])
  effect: 'allow' | 'deny';

  @IsArray()
  @IsString({ each: true })
  actions: string[];

  @IsArray()
  @IsString({ each: true })
  resources: string[];

  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @Max(999)
  priority: number;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsEnum(['allow', 'deny'])
  effect?: 'allow' | 'deny';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resources?: string[];

  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  priority?: number;
}

// ─── Tenant DTOs ─────────────────────────────────────────────

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,49}$/, {
    message: 'code must be lowercase alphanumeric + hyphen, 3-50 chars',
  })
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

// ─── Break-Glass DTOs ────────────────────────────────────────

export class ActivateBreakGlassDto {
  @IsString()
  @MinLength(20)
  reason: string;

  @IsString()
  @IsNotEmpty()
  targetResource: string;

  @IsString()
  @IsNotEmpty()
  targetRole: string;
}

export class CoSignBreakGlassDto {
  @IsUUID()
  supervisorId: string;

  @IsString()
  @Length(6, 6)
  mfaCode: string;
}

// ─── Response DTOs ───────────────────────────────────────────

export interface UserDto {
  id: string;
  tenantId: string;
  email: string;
  phone: string | null;
  fullName: string;
  clearance: number;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetailDto extends UserDto {
  attributes: Record<string, unknown>;
  roles: RoleDto[];
  groups: GroupDto[];
  activeSessionCount: number;
}

export interface RoleDto {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
}

export interface RoleDetailDto extends RoleDto {
  permissions: PermissionDto[];
}

export interface PermissionDto {
  id: string;
  code: string;
  description: string;
}

export interface PolicyDto {
  id: string;
  tenantId: string;
  name: string;
  effect: 'allow' | 'deny';
  actions: string[];
  resources: string[];
  condition: Record<string, unknown> | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDto {
  id: string;
  code: string;
  name: string;
  region: string | null;
  parentId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDto {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface GroupDto {
  id: string;
  name: string;
  description: string | null;
}
```

### Error Codes

| Code                             | HTTP | Description                                           |
| -------------------------------- | ---- | ----------------------------------------------------- |
| AUTH_INVALID_CREDENTIALS         | 401  | Email or password is incorrect                        |
| AUTH_ACCOUNT_LOCKED              | 403  | Account locked after too many failed attempts         |
| AUTH_ACCOUNT_DISABLED            | 403  | Account has been administratively disabled            |
| AUTH_MFA_INVALID                 | 401  | MFA code or assertion is incorrect                    |
| AUTH_MFA_EXPIRED                 | 401  | MFA challenge token has expired                       |
| AUTH_REFRESH_INVALID             | 401  | Refresh token is invalid or expired                   |
| AUTH_REFRESH_REUSE_DETECTED      | 401  | Refresh token reuse detected; all sessions revoked    |
| IAM_USER_NOT_FOUND               | 404  | User does not exist or was deleted                    |
| IAM_USER_ALREADY_EXISTS          | 409  | A user with this email already exists                 |
| IAM_ROLE_NOT_FOUND               | 404  | Role does not exist                                   |
| IAM_ROLE_CONFLICT                | 409  | Role assignment conflicts with existing role          |
| IAM_PERMISSION_DENIED            | 403  | Actor lacks required permission                       |
| IAM_CLEARANCE_ESCALATION_DENIED  | 403  | Cannot escalate clearance beyond own level            |
| IAM_POLICY_INVALID               | 422  | Policy condition JSON is malformed or invalid         |
| IAM_TENANT_SUSPENDED             | 403  | Tenant is suspended; all operations blocked           |
| IAM_SESSION_EXPIRED              | 401  | Session has expired                                   |
| IAM_MFA_REQUIRED                 | 403  | MFA enrollment is mandatory for this user             |
| IAM_BREAKGLASS_COSIGN_TIMEOUT    | 408  | Co-sign window expired                                |
| IAM_BREAKGLASS_DENIED            | 403  | Supervisor lacks authority or denied co-sign          |

---

## 6. Events

### Standard Event Envelope

All events use the following envelope structure, serialized as JSON and published to NATS JetStream:

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
    type: 'user' | 'system' | 'api_key';
    id: string;
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

### Events Produced

#### iam.user.created.v1

```typescript
{
  type: 'iam.user.created.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    tenantId: string;
    email: string;
    fullName: string;
    clearance: number;
    status: string;
    roles: [];
  }
}
```

NATS subject: `iam.user.created.v1`

#### iam.user.updated.v1

```typescript
{
  type: 'iam.user.updated.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    tenantId: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }
}
```

NATS subject: `iam.user.updated.v1`

#### iam.user.deactivated.v1

```typescript
{
  type: 'iam.user.deactivated.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    tenantId: string;
    reason: string;
  }
}
```

NATS subject: `iam.user.deactivated.v1`

#### iam.role.assigned.v1

```typescript
{
  type: 'iam.role.assigned.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    roleId: string;
    roleCode: string;
    scope: Record<string, unknown> | null;
    grantedBy: string;
    expiresAt: string | null;
  }
}
```

NATS subject: `iam.role.assigned.v1`

#### iam.role.revoked.v1

```typescript
{
  type: 'iam.role.revoked.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    roleId: string;
    roleCode: string;
    revokedBy: string;
  }
}
```

NATS subject: `iam.role.revoked.v1`

#### iam.clearance.changed.v1

```typescript
{
  type: 'iam.clearance.changed.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    from: number;
    to: number;
    reason: string;
    changedBy: string;
  }
}
```

NATS subject: `iam.clearance.changed.v1`

#### iam.session.opened.v1

```typescript
{
  type: 'iam.session.opened.v1',
  subject: { type: 'session', id: '<session_id>' },
  data: {
    sessionId: string;
    userId: string;
    tenantId: string;
    ip: string;
    userAgent: string;
  }
}
```

NATS subject: `iam.session.opened.v1`

#### iam.session.closed.v1

```typescript
{
  type: 'iam.session.closed.v1',
  subject: { type: 'session', id: '<session_id>' },
  data: {
    sessionId: string;
    userId: string;
    reason: 'logout' | 'expired' | 'revoked' | 'reuse_detected';
  }
}
```

NATS subject: `iam.session.closed.v1`

#### iam.mfa.enrolled.v1

```typescript
{
  type: 'iam.mfa.enrolled.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    userId: string;
    factorType: 'totp' | 'webauthn';
  }
}
```

NATS subject: `iam.mfa.enrolled.v1`

#### iam.policy.changed.v1

```typescript
{
  type: 'iam.policy.changed.v1',
  subject: { type: 'policy', id: '<policy_id>' },
  data: {
    policyId: string;
    tenantId: string;
    action: 'created' | 'updated' | 'deleted';
  }
}
```

NATS subject: `iam.policy.changed.v1`

#### iam.breakglass.activated.v1

```typescript
{
  type: 'iam.breakglass.activated.v1',
  subject: { type: 'user', id: '<user_id>' },
  data: {
    activationId: string;
    userId: string;
    targetResource: string;
    elevatedRole: string;
    expiresAt: string;
    reason: string;
    coSignedBy: string;
  }
}
```

NATS subject: `iam.breakglass.activated.v1`

#### iam.breakglass.expired.v1

```typescript
{
  type: 'iam.breakglass.expired.v1',
  subject: { type: 'breakglass', id: '<activation_id>' },
  data: {
    activationId: string;
    userId: string;
  }
}
```

NATS subject: `iam.breakglass.expired.v1`

#### iam.tenant.created.v1

```typescript
{
  type: 'iam.tenant.created.v1',
  subject: { type: 'tenant', id: '<tenant_id>' },
  data: {
    tenantId: string;
    code: string;
    name: string;
    region: string | null;
    parentId: string | null;
  }
}
```

NATS subject: `iam.tenant.created.v1`

#### iam.tenant.suspended.v1

```typescript
{
  type: 'iam.tenant.suspended.v1',
  subject: { type: 'tenant', id: '<tenant_id>' },
  data: {
    tenantId: string;
    reason: string;
  }
}
```

NATS subject: `iam.tenant.suspended.v1`

### Events Consumed

| Event                          | Source   | Handler                                                                              |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| iam.breakglass.activated.v1    | Self     | Schedule auto-expiry via NATS delayed message (4h). On expiry: revoke temp role, emit `iam.breakglass.expired.v1`. |

IAM is primarily a producer. Other modules call IAM's `CheckPermission` query in-process rather than via events.

---

## 7. Database Schema

### Schema Setup

```sql
CREATE SCHEMA IF NOT EXISTS iam;

-- Required extensions (run in shared/public schema)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

### iam.tenants

```sql
CREATE TABLE iam.tenants (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    name        text        NOT NULL,
    region      text,
    parent_id   uuid        REFERENCES iam.tenants(id) ON DELETE SET NULL,
    status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'archived')),
    settings    jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenants_code_unique UNIQUE (code),
    CONSTRAINT tenants_code_format CHECK (code ~ '^[a-z][a-z0-9-]{2,49}$'),
    CONSTRAINT tenants_name_length CHECK (length(name) BETWEEN 2 AND 200)
);

CREATE INDEX idx_tenants_parent_id ON iam.tenants(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_tenants_status ON iam.tenants(status);
```

### iam.users

```sql
CREATE TABLE iam.users (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES iam.tenants(id) ON DELETE RESTRICT,
    email           citext      NOT NULL,
    phone           text,
    full_name       text        NOT NULL,
    password_hash   text,
    clearance       smallint    NOT NULL DEFAULT 1
                                CHECK (clearance BETWEEN 1 AND 4),
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('active', 'disabled', 'locked', 'pending')),
    failed_attempts smallint    NOT NULL DEFAULT 0,
    last_login_at   timestamptz,
    mfa_enabled     boolean     NOT NULL DEFAULT false,
    attributes      jsonb       NOT NULL DEFAULT '{}',
    role_version    integer     NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_length CHECK (length(email) <= 254),
    CONSTRAINT users_full_name_length CHECK (length(full_name) BETWEEN 2 AND 200),
    CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{1,14}$')
);

-- Partial unique index: only enforce email uniqueness among non-deleted users
-- (the UNIQUE constraint above covers all rows; if soft-delete reuse is needed,
--  drop the table-level constraint and use this partial index instead)
CREATE UNIQUE INDEX idx_users_email_active ON iam.users(email) WHERE deleted_at IS NULL;

-- Trigram index for fuzzy search on email and full_name
CREATE INDEX idx_users_email_trgm ON iam.users USING gin (email gin_trgm_ops);
CREATE INDEX idx_users_full_name_trgm ON iam.users USING gin (full_name gin_trgm_ops);

CREATE INDEX idx_users_tenant_id ON iam.users(tenant_id);
CREATE INDEX idx_users_status ON iam.users(status);
CREATE INDEX idx_users_clearance ON iam.users(clearance);
CREATE INDEX idx_users_created_at ON iam.users(created_at);
CREATE INDEX idx_users_deleted_at ON iam.users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION iam.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON iam.users
    FOR EACH ROW EXECUTE FUNCTION iam.set_updated_at();
```

### iam.roles

```sql
CREATE TABLE iam.roles (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid        REFERENCES iam.tenants(id) ON DELETE CASCADE,
    code        text        NOT NULL,
    name        text        NOT NULL,
    description text,
    is_system   boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]{2,49}$'),
    CONSTRAINT roles_name_length CHECK (length(name) BETWEEN 2 AND 200)
);

-- Unique role code per tenant (including system roles where tenant_id is null)
CREATE UNIQUE INDEX idx_roles_tenant_code ON iam.roles(tenant_id, code);
CREATE UNIQUE INDEX idx_roles_system_code ON iam.roles(code) WHERE tenant_id IS NULL;

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON iam.roles
    FOR EACH ROW EXECUTE FUNCTION iam.set_updated_at();
```

### iam.permissions

```sql
CREATE TABLE iam.permissions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    description text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT permissions_code_unique UNIQUE (code),
    CONSTRAINT permissions_code_format CHECK (code ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
    CONSTRAINT permissions_code_length CHECK (length(code) BETWEEN 3 AND 100)
);
```

### iam.role_permissions

```sql
CREATE TABLE iam.role_permissions (
    role_id       uuid NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES iam.permissions(id) ON DELETE CASCADE,

    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_permission_id ON iam.role_permissions(permission_id);
```

### iam.user_roles

```sql
CREATE TABLE iam.user_roles (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    role_id    uuid        NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
    scope      jsonb,      -- ABAC scope restriction (e.g., { "tenant_id": "..." })
    granted_by uuid        NOT NULL REFERENCES iam.users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,

    CONSTRAINT user_roles_not_self_grant CHECK (user_id != granted_by OR granted_by IS NOT NULL)
);

-- Only one active assignment of the same role per user
CREATE UNIQUE INDEX idx_user_roles_active ON iam.user_roles(user_id, role_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_user_roles_user_id ON iam.user_roles(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_role_id ON iam.user_roles(role_id);
CREATE INDEX idx_user_roles_expires_at ON iam.user_roles(expires_at)
    WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
```

### iam.policies

```sql
CREATE TABLE iam.policies (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid        NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    effect      text        NOT NULL CHECK (effect IN ('allow', 'deny')),
    actions     text[]      NOT NULL DEFAULT '{}',
    resources   text[]      NOT NULL DEFAULT '{}',
    condition   jsonb,
    priority    smallint    NOT NULL DEFAULT 100,
    version     integer     NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,

    CONSTRAINT policies_name_length CHECK (length(name) BETWEEN 2 AND 200),
    CONSTRAINT policies_priority_range CHECK (priority BETWEEN 0 AND 999)
);

CREATE INDEX idx_policies_tenant_id ON iam.policies(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_policies_priority ON iam.policies(tenant_id, priority) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_policies_updated_at
    BEFORE UPDATE ON iam.policies
    FOR EACH ROW EXECUTE FUNCTION iam.set_updated_at();
```

### iam.sessions

```sql
CREATE TABLE iam.sessions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    refresh_hash text        NOT NULL,
    user_agent   text,
    ip           inet,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    rotated_at   timestamptz,

    CONSTRAINT sessions_refresh_hash_unique UNIQUE (refresh_hash)
);

-- Active sessions per user (for concurrent session limit check)
CREATE INDEX idx_sessions_user_active ON iam.sessions(user_id, created_at)
    WHERE revoked_at IS NULL;

-- Lookup by refresh hash for token validation
CREATE INDEX idx_sessions_refresh_hash ON iam.sessions(refresh_hash)
    WHERE revoked_at IS NULL;

-- Cleanup: expired sessions
CREATE INDEX idx_sessions_expires_at ON iam.sessions(expires_at)
    WHERE revoked_at IS NULL;
```

### iam.groups

```sql
CREATE TABLE iam.groups (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid        NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT groups_name_length CHECK (length(name) BETWEEN 2 AND 200)
);

CREATE INDEX idx_groups_tenant_id ON iam.groups(tenant_id);

CREATE TRIGGER trg_groups_updated_at
    BEFORE UPDATE ON iam.groups
    FOR EACH ROW EXECUTE FUNCTION iam.set_updated_at();
```

### iam.group_members

```sql
CREATE TABLE iam.group_members (
    group_id uuid        NOT NULL REFERENCES iam.groups(id) ON DELETE CASCADE,
    user_id  uuid        NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    added_by uuid        NOT NULL REFERENCES iam.users(id),

    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user_id ON iam.group_members(user_id);
```

### iam.mfa_factors

```sql
CREATE TABLE iam.mfa_factors (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    type             text        NOT NULL CHECK (type IN ('totp', 'webauthn')),
    secret_encrypted text,
    credential_id    text,
    public_key       text,
    verified_at      timestamptz,
    last_used_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_factors_user_id ON iam.mfa_factors(user_id);
CREATE INDEX idx_mfa_factors_user_verified ON iam.mfa_factors(user_id)
    WHERE verified_at IS NOT NULL;
```

### iam.api_keys

```sql
CREATE TABLE iam.api_keys (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    tenant_id    uuid        NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
    key_hash     text        NOT NULL,
    name         text        NOT NULL,
    scopes       text[]      NOT NULL DEFAULT '{}',
    expires_at   timestamptz,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT api_keys_hash_unique UNIQUE (key_hash)
);

CREATE INDEX idx_api_keys_user_id ON iam.api_keys(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_hash ON iam.api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_tenant_id ON iam.api_keys(tenant_id);
```

### iam.breakglass_activations

```sql
CREATE TABLE iam.breakglass_activations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES iam.users(id),
    tenant_id       uuid        NOT NULL REFERENCES iam.tenants(id),
    target_resource text        NOT NULL,
    elevated_role   text        NOT NULL,
    reason          text        NOT NULL,
    status          text        NOT NULL DEFAULT 'pending_cosign'
                                CHECK (status IN ('pending_cosign', 'active', 'expired', 'denied')),
    cosigned_by     uuid        REFERENCES iam.users(id),
    cosign_deadline timestamptz NOT NULL,
    activated_at    timestamptz,
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_breakglass_user_id ON iam.breakglass_activations(user_id);
CREATE INDEX idx_breakglass_status ON iam.breakglass_activations(status)
    WHERE status IN ('pending_cosign', 'active');
```

### iam.outbox (Transactional Outbox Pattern)

```sql
CREATE TABLE iam.outbox (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type     text        NOT NULL,
    tenant_id      uuid        NOT NULL,
    payload        jsonb       NOT NULL,
    correlation_id uuid        NOT NULL,
    causation_id   uuid        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,

    CONSTRAINT outbox_event_type_not_empty CHECK (length(event_type) > 0)
);

-- Poll for unpublished events
CREATE INDEX idx_outbox_unpublished ON iam.outbox(created_at)
    WHERE published_at IS NULL;
```

### Row-Level Security (RLS) Policies

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE iam.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.breakglass_activations ENABLE ROW LEVEL SECURITY;

-- The application sets current_setting('app.current_tenant_id') on each connection/transaction.
-- Platform admins set it to a wildcard or use a bypass role.

-- Users: tenant isolation
CREATE POLICY tenant_isolation_users ON iam.users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Roles: tenant isolation (system roles visible to all)
CREATE POLICY tenant_isolation_roles ON iam.roles
    USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id')::uuid
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policies: tenant isolation
CREATE POLICY tenant_isolation_policies ON iam.policies
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Groups: tenant isolation
CREATE POLICY tenant_isolation_groups ON iam.groups
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- API keys: tenant isolation
CREATE POLICY tenant_isolation_api_keys ON iam.api_keys
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Sessions: user can see own sessions; admin can see all in tenant
CREATE POLICY tenant_isolation_sessions ON iam.sessions
    USING (
        user_id IN (
            SELECT id FROM iam.users
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Break-glass: tenant isolation
CREATE POLICY tenant_isolation_breakglass ON iam.breakglass_activations
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Bypass policy for the platform_admin database role
CREATE POLICY platform_admin_bypass_users ON iam.users
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_roles ON iam.roles
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_policies ON iam.policies
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_groups ON iam.groups
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_api_keys ON iam.api_keys
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_sessions ON iam.sessions
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY platform_admin_bypass_breakglass ON iam.breakglass_activations
    FOR ALL
    TO sentinel_platform_admin
    USING (true)
    WITH CHECK (true);
```

---

## 8. RBAC Full Model

### System Roles with Complete Permission Mapping

#### duty_operator

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| incident.read           | View all incidents in own tenant     |
| incident.create         | Create new incidents                 |
| task.read               | View all tasks                       |
| sitrep.create           | Submit situation reports             |
| chat.read.incident      | Read incident chat channels          |
| chat.post               | Post messages in allowed channels    |
| file.upload             | Upload files/attachments             |
| notification.read       | View own notifications               |

#### shift_lead

Inherits all `duty_operator` permissions, plus:

| Permission                      | Description                               |
| ------------------------------- | ----------------------------------------- |
| incident.assign.commander       | Assign incident commander                 |
| incident.update.severity        | Update severity (lower only)              |
| task.assign                     | Assign tasks to users                     |
| task.create                     | Create new tasks                          |
| document.approve.level1         | Level 1 document approval                 |
| document.read                   | Read documents                            |

#### incident_commander

Inherits all `shift_lead` permissions, plus:

| Permission                      | Description                               |
| ------------------------------- | ----------------------------------------- |
| incident.update.status          | Update incident status                    |
| incident.update.severity        | Update severity (raise and lower)         |
| task.update                     | Update any task                           |
| document.approve.level2         | Level 2 document approval                 |
| document.create                 | Create documents                          |
| call.start                      | Initiate voice/video calls                |
| call.record                     | Start/stop call recording                 |
| gis.feature.create              | Create GIS features                       |

#### field_responder

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| sitrep.create           | Submit situation reports             |
| task.read.own           | View own assigned tasks              |
| task.update.own         | Update own assigned tasks            |
| chat.post               | Post messages in allowed channels    |
| file.upload             | Upload files/attachments             |
| gis.feature.create      | Create GIS features                  |
| notification.read       | View own notifications               |

#### gis_analyst

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| gis.layer.create        | Create new GIS layers                |
| gis.layer.update        | Update existing layers               |
| gis.layer.publish       | Publish layers for consumption       |
| gis.feature.create      | Create GIS features                  |
| gis.feature.update      | Update GIS features                  |
| gis.feature.delete      | Delete GIS features                  |
| incident.read           | View incidents (context for GIS)     |

#### agency_liaison

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| incident.read.scoped    | View incidents scoped to liaison     |
| chat.post               | Post messages                        |
| chat.read.incident      | Read incident chat channels          |
| task.read               | View tasks                           |
| document.read           | Read documents                       |

#### analyst

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| analytics.read          | View analytics dashboards            |
| analytics.export        | Export analytics data                 |
| incident.read           | View incidents                       |
| task.read               | View tasks                           |
| document.read           | Read documents                       |

#### tenant_admin

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| admin.user.manage       | Create/update/deactivate users       |
| admin.role.manage       | Manage role assignments              |
| admin.policy.manage     | Create/update/delete ABAC policies   |
| audit.read.own_tenant   | View audit logs for own tenant       |

#### platform_admin

All permissions across all tenants. This role bypasses tenant isolation via the `sentinel_platform_admin` database role.

#### auditor

| Permission              | Description                          |
| ----------------------- | ------------------------------------ |
| audit.read              | View audit logs (all tenants)        |
| incident.read           | View incidents (all tenants)         |
| task.read               | View tasks (all tenants)             |
| document.read           | Read documents (all tenants)         |
| chat.read               | Read chat messages (all tenants)     |

All auditor permissions are strictly read-only. Auditors cannot modify any resource.

### Role Hierarchy

The hierarchy determines role inheritance for permission resolution:

```
platform_admin
  └── tenant_admin
       └── incident_commander
            └── shift_lead
                 └── duty_operator
```

Lateral roles (no hierarchy, no inheritance):

- `field_responder`
- `gis_analyst`
- `agency_liaison`
- `analyst`
- `auditor`

When resolving permissions for a user, the PDP collects all permissions from all assigned roles (including inherited permissions from the hierarchy chain) and applies ABAC policies on top.

### Complete Permission Registry

```sql
INSERT INTO iam.permissions (id, code, description) VALUES
    -- Incident permissions
    (gen_random_uuid(), 'incident.read', 'View incidents'),
    (gen_random_uuid(), 'incident.read.scoped', 'View incidents scoped to user assignment'),
    (gen_random_uuid(), 'incident.create', 'Create new incidents'),
    (gen_random_uuid(), 'incident.update.status', 'Update incident status'),
    (gen_random_uuid(), 'incident.update.severity', 'Update incident severity'),
    (gen_random_uuid(), 'incident.assign.commander', 'Assign incident commander'),

    -- Task permissions
    (gen_random_uuid(), 'task.read', 'View all tasks'),
    (gen_random_uuid(), 'task.read.own', 'View own assigned tasks'),
    (gen_random_uuid(), 'task.create', 'Create tasks'),
    (gen_random_uuid(), 'task.assign', 'Assign tasks to users'),
    (gen_random_uuid(), 'task.update', 'Update any task'),
    (gen_random_uuid(), 'task.update.own', 'Update own assigned tasks'),

    -- Sitrep permissions
    (gen_random_uuid(), 'sitrep.create', 'Submit situation reports'),

    -- Chat permissions
    (gen_random_uuid(), 'chat.read', 'Read all chat messages'),
    (gen_random_uuid(), 'chat.read.incident', 'Read incident-scoped chat channels'),
    (gen_random_uuid(), 'chat.post', 'Post chat messages'),

    -- File permissions
    (gen_random_uuid(), 'file.upload', 'Upload files and attachments'),

    -- Document permissions
    (gen_random_uuid(), 'document.read', 'Read documents'),
    (gen_random_uuid(), 'document.create', 'Create documents'),
    (gen_random_uuid(), 'document.approve.level1', 'Level 1 document approval'),
    (gen_random_uuid(), 'document.approve.level2', 'Level 2 document approval'),

    -- Call permissions
    (gen_random_uuid(), 'call.start', 'Initiate voice/video calls'),
    (gen_random_uuid(), 'call.record', 'Start/stop call recording'),

    -- GIS permissions
    (gen_random_uuid(), 'gis.layer.create', 'Create GIS layers'),
    (gen_random_uuid(), 'gis.layer.update', 'Update GIS layers'),
    (gen_random_uuid(), 'gis.layer.publish', 'Publish GIS layers'),
    (gen_random_uuid(), 'gis.feature.create', 'Create GIS features'),
    (gen_random_uuid(), 'gis.feature.update', 'Update GIS features'),
    (gen_random_uuid(), 'gis.feature.delete', 'Delete GIS features'),

    -- Notification permissions
    (gen_random_uuid(), 'notification.read', 'View notifications'),

    -- Analytics permissions
    (gen_random_uuid(), 'analytics.read', 'View analytics dashboards'),
    (gen_random_uuid(), 'analytics.export', 'Export analytics data'),

    -- Admin permissions
    (gen_random_uuid(), 'admin.user.manage', 'Manage users (create, update, deactivate)'),
    (gen_random_uuid(), 'admin.role.manage', 'Manage role assignments'),
    (gen_random_uuid(), 'admin.policy.manage', 'Manage ABAC policies'),

    -- Audit permissions
    (gen_random_uuid(), 'audit.read', 'View audit logs (all tenants)'),
    (gen_random_uuid(), 'audit.read.own_tenant', 'View audit logs (own tenant)')
;
```

---

## 9. ABAC Preparation

### Policy Structure

```json
{
  "name": "policy-name",
  "effect": "allow",
  "actions": ["domain.action", "domain.action.*"],
  "resources": ["resource_type:*", "resource_type:${resource.id}"],
  "condition": {
    "all": [
      { "stringEquals": { "subject.tenant_id": "resource.tenant_id" } },
      { "numericGte": { "subject.clearance": "resource.classification" } }
    ]
  }
}
```

### Condition Evaluation

Conditions are expressed as a tree of predicates. The top level must be either `all` (AND) or `any` (OR). Each predicate is an object with a single operator key mapping a subject/environment field to a value or resource field.

**Field references**:

- `subject.*` -- fields from the authenticated user context (e.g., `subject.tenant_id`, `subject.clearance`, `subject.id`, `subject.attributes.department`)
- `resource.*` -- fields from the resource being accessed (e.g., `resource.tenant_id`, `resource.classification`, `resource.owner_id`)
- `env.*` -- environment context (e.g., `env.time`, `env.ip`)
- Literal values are expressed directly (strings, numbers, booleans)

### Supported Operators

| Operator          | Operand Types   | Description                                       |
| ----------------- | --------------- | ------------------------------------------------- |
| stringEquals      | string, string  | Exact string match                                |
| stringNotEquals   | string, string  | Negated exact string match                        |
| stringLike        | string, pattern | Glob match (supports `*` and `?`)                |
| numericEquals     | number, number  | Exact numeric match                               |
| numericGte        | number, number  | Greater than or equal                             |
| numericLte        | number, number  | Less than or equal                                |
| numericGt         | number, number  | Greater than                                      |
| numericLt         | number, number  | Less than                                         |
| bool              | boolean, boolean| Boolean match                                     |
| dateGreaterThan   | ISO 8601, ISO 8601 | Date comparison (after)                        |
| dateLessThan      | ISO 8601, ISO 8601 | Date comparison (before)                       |
| ipAddress         | IP, CIDR        | CIDR match (e.g., "10.0.0.0/8")                  |

### Condition Nesting

Conditions support arbitrary nesting:

```json
{
  "all": [
    { "stringEquals": { "subject.tenant_id": "resource.tenant_id" } },
    {
      "any": [
        { "numericGte": { "subject.clearance": "resource.classification" } },
        { "stringEquals": { "subject.id": "resource.owner_id" } }
      ]
    }
  ]
}
```

### Standard ABAC Policies (Shipped with System)

#### 1. Tenant Isolation

```json
{
  "name": "system-tenant-isolation",
  "effect": "deny",
  "actions": ["*"],
  "resources": ["*"],
  "condition": {
    "all": [
      { "stringNotEquals": { "subject.tenant_id": "resource.tenant_id" } }
    ]
  },
  "priority": 0
}
```

This policy denies all cross-tenant access. Priority 0 ensures it is evaluated first. Platform admins bypass this via the database-level bypass role.

#### 2. Clearance Gate

```json
{
  "name": "system-clearance-gate",
  "effect": "deny",
  "actions": ["*.read", "*.update", "*.delete"],
  "resources": ["*"],
  "condition": {
    "all": [
      { "numericLt": { "subject.clearance": "resource.classification" } }
    ]
  },
  "priority": 1
}
```

Denies access when the user's clearance is lower than the resource's classification level.

#### 3. Commander Owns Incident

```json
{
  "name": "system-commander-owns-incident",
  "effect": "allow",
  "actions": ["incident.update.*"],
  "resources": ["incident:*"],
  "condition": {
    "all": [
      { "stringEquals": { "subject.id": "resource.commander_id" } }
    ]
  },
  "priority": 50
}
```

Allows incident commanders to update incidents they command, independent of other role checks.

#### 4. Break-Glass Time Bound

```json
{
  "name": "system-breakglass-expiry",
  "effect": "deny",
  "actions": ["*"],
  "resources": ["*"],
  "condition": {
    "all": [
      { "bool": { "subject.attributes.breakglass_active": true } },
      { "dateGreaterThan": { "env.time": "subject.attributes.breakglass_expires_at" } }
    ]
  },
  "priority": 2
}
```

Denies access after break-glass expiry (4h). This serves as a defense-in-depth backstop; the primary expiry is handled by scheduled NATS messages revoking the temporary role.

#### 5. IP Restriction for Admin Operations

```json
{
  "name": "system-admin-ip-restriction",
  "effect": "deny",
  "actions": ["admin.*"],
  "resources": ["*"],
  "condition": {
    "all": [
      { "stringNotEquals": { "subject.attributes.ip_allowed": true } }
    ]
  },
  "priority": 3
}
```

In production, this is implemented with CIDR matching:

```json
{
  "name": "system-admin-ip-restriction",
  "effect": "deny",
  "actions": ["admin.*"],
  "resources": ["*"],
  "condition": {
    "all": [
      {
        "any": [
          { "ipAddress": { "env.ip": "10.0.0.0/8" } },
          { "ipAddress": { "env.ip": "172.16.0.0/12" } }
        ]
      }
    ]
  },
  "priority": 3
}
```

Note: The outer `any` means access is allowed from any of the listed CIDRs. Since the effect is `deny`, the condition is inverted -- the deny fires when the IP does NOT match any allowed CIDR. The actual implementation inverts the `any` to check non-membership.

---

## 10. Login Flow

### Step-by-Step Sequence

```
Client                         Server                           Database / Redis
  |                              |                                    |
  |  POST /auth/login            |                                    |
  |  { email, password }         |                                    |
  |----------------------------->|                                    |
  |                              |  1. SELECT * FROM iam.users        |
  |                              |     WHERE email = $1               |
  |                              |     AND deleted_at IS NULL         |
  |                              |------------------------------------>|
  |                              |                                    |
  |                              |  2. If not found: constant-time    |
  |                              |     argon2 hash (prevent timing    |
  |                              |     enumeration), return 401       |
  |                              |     AUTH_INVALID_CREDENTIALS       |
  |                              |                                    |
  |                              |  3. Check user.status              |
  |                              |     - 'disabled' -> 403            |
  |                              |       AUTH_ACCOUNT_DISABLED        |
  |                              |     - 'locked' -> 403             |
  |                              |       AUTH_ACCOUNT_LOCKED          |
  |                              |     - 'pending' -> 403            |
  |                              |       AUTH_ACCOUNT_DISABLED        |
  |                              |                                    |
  |                              |  4. Check tenant.status            |
  |                              |     SELECT status FROM iam.tenants |
  |                              |     WHERE id = user.tenant_id      |
  |                              |------------------------------------>|
  |                              |     - 'suspended' -> 403           |
  |                              |       IAM_TENANT_SUSPENDED         |
  |                              |                                    |
  |                              |  5. Verify password with argon2id  |
  |                              |     - Wrong: increment             |
  |                              |       failed_attempts              |
  |                              |     - If failed_attempts >= 5:     |
  |                              |       SET status = 'locked'        |
  |                              |     - Return 401                   |
  |                              |       AUTH_INVALID_CREDENTIALS     |
  |                              |                                    |
  |                              |  6. Password correct:              |
  |                              |     SET failed_attempts = 0,       |
  |                              |     last_login_at = now()          |
  |                              |------------------------------------>|
  |                              |                                    |
  |                              |  7. Check for verified MFA factor  |
  |                              |     SELECT * FROM iam.mfa_factors  |
  |                              |     WHERE user_id = $1             |
  |                              |     AND verified_at IS NOT NULL    |
  |                              |------------------------------------>|
  |                              |                                    |
  |  [IF MFA REQUIRED]           |                                    |
  |                              |  8. Generate challenge_token:      |
  |                              |     JWT { sub: user_id,            |
  |                              |       type: 'mfa_challenge',       |
  |                              |       factor: 'totp'|'webauthn',   |
  |                              |       exp: now() + 5min }          |
  |                              |     Sign with RS256                |
  |<-----------------------------|                                    |
  |  { mfaRequired: true,       |                                    |
  |    challengeToken: "...",    |                                    |
  |    mfaType: "totp" }        |                                    |
  |                              |                                    |
  |  POST /auth/mfa/verify       |                                    |
  |  { challengeToken, code }    |                                    |
  |----------------------------->|                                    |
  |                              |  9. Decode challenge_token         |
  |                              |     Verify signature + expiry      |
  |                              |     Verify TOTP code (with         |
  |                              |     1-step time drift tolerance)   |
  |                              |     or WebAuthn assertion          |
  |                              |     - Wrong: 401 AUTH_MFA_INVALID  |
  |                              |     Update mfa_factor.last_used_at |
  |                              |------------------------------------>|
  |                              |                                    |
  |  [TOKEN ISSUANCE - step 10+] |                                    |
  |                              |  10. Generate access_token (JWT):  |
  |                              |      { sub: user_id,               |
  |                              |        tid: tenant_id,             |
  |                              |        sid: session_id,            |
  |                              |        clr: clearance,             |
  |                              |        roles: [role_codes],        |
  |                              |        iat: now(),                 |
  |                              |        exp: now() + 10min }        |
  |                              |      Sign with RS256               |
  |                              |                                    |
  |                              |  11. Generate refresh_token:       |
  |                              |      "sntl_rt_" + base64url(       |
  |                              |        32 random bytes)            |
  |                              |      Hash: SHA-256(refresh_token)  |
  |                              |      INSERT INTO iam.sessions      |
  |                              |      (refresh_hash, user_id,       |
  |                              |       user_agent, ip,              |
  |                              |       expires_at: now() + 24h)     |
  |                              |------------------------------------>|
  |                              |                                    |
  |                              |  12. Write to iam.outbox:          |
  |                              |      iam.session.opened.v1         |
  |                              |------------------------------------>|
  |                              |                                    |
  |                              |  13. Set refresh token as          |
  |                              |      HttpOnly Secure               |
  |                              |      SameSite=Strict cookie        |
  |<-----------------------------|                                    |
  |  { accessToken: "...",       |                                    |
  |    refreshToken: "...",      |                                    |
  |    mfaRequired: false }      |                                    |
  |                              |                                    |
  |                              |  14. Check concurrent sessions:    |
  |                              |      SELECT COUNT(*) FROM          |
  |                              |      iam.sessions WHERE            |
  |                              |      user_id = $1 AND             |
  |                              |      revoked_at IS NULL            |
  |                              |------------------------------------>|
  |                              |      If > 5: revoke oldest         |
  |                              |      PUBLISH iam:session:revoked   |
  |                              |      to Redis                      |
  |                              |------------------------------------>|
```

### Timing Attack Prevention

When a user is not found by email, the server still performs a dummy argon2id hash computation to ensure the response time is indistinguishable from a valid-user-wrong-password scenario. This prevents email enumeration via timing analysis.

---

## 11. Session Management

### Token Lifetimes

| Token          | Format                           | TTL    | Storage                           |
| -------------- | -------------------------------- | ------ | --------------------------------- |
| Access Token   | JWT (RS256)                      | 10 min | Stateless (client-side only)      |
| Refresh Token  | `sntl_rt_<base64url(32 bytes)>`  | 8 h    | SHA-256 hash in `iam.sessions`    |
| Challenge Token| JWT (RS256)                      | 5 min  | Stateless                         |

### Absolute Session Timeout

A session cannot be refreshed beyond 24 hours from `created_at`, even if the refresh token has not expired. This is enforced during the RefreshToken command by checking `session.created_at + INTERVAL '24 hours' > now()`.

### Token Rotation

Every successful refresh operation:

1. Marks the current session's `rotated_at = now()`.
2. Creates a new session row with a new `refresh_hash`.
3. Issues a new access token and refresh token.
4. The old refresh hash is retained for reuse detection.

### Reuse Detection

If a refresh token is presented whose corresponding session has `rotated_at IS NOT NULL`, this means the token has already been used and rotated. This indicates token theft (an attacker is replaying an old token). Response:

1. Revoke ALL sessions for the user (`UPDATE iam.sessions SET revoked_at = now() WHERE user_id = $1`).
2. Publish to Redis channel `iam:session:revoked:{user_id}`.
3. Emit `iam.session.closed.v1` for each revoked session with reason `reuse_detected`.
4. Return 401 `AUTH_REFRESH_REUSE_DETECTED`.

### Session Revocation Propagation

```
Application Server          Redis                    Realtime Gateway
     |                        |                            |
     |  PUBLISH               |                            |
     |  iam:session:revoked:  |                            |
     |  {user_id}             |                            |
     |----------------------->|                            |
     |                        |  Deliver to subscribers    |
     |                        |--------------------------->|
     |                        |                            |
     |                        |                            |  Disconnect
     |                        |                            |  WebSocket
     |                        |                            |  within 1s
```

### Device Tracking

Each session stores `user_agent` and `ip`. These are displayed in the user's session management UI (`GET /users/:id/sessions`). Users can revoke individual sessions.

### Concurrent Session Limit

Maximum 5 active sessions per user. Enforced at login time:

```sql
WITH active_sessions AS (
    SELECT id, created_at
    FROM iam.sessions
    WHERE user_id = $1 AND revoked_at IS NULL
    ORDER BY created_at ASC
)
UPDATE iam.sessions
SET revoked_at = now()
WHERE id IN (
    SELECT id FROM active_sessions
    OFFSET 0 LIMIT (SELECT GREATEST(COUNT(*) - 4, 0) FROM active_sessions)
);
```

This revokes the oldest sessions to make room for the new one, maintaining a maximum of 5.

---

## 12. Token Flow

### Access Token (JWT) Structure

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "2026-q1-primary"
  },
  "payload": {
    "sub": "01961a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b",
    "tid": "01961a2b-0000-7000-8000-000000000001",
    "sid": "01961a2b-4444-7000-8000-000000000099",
    "clr": 3,
    "roles": ["incident_commander", "shift_lead"],
    "iat": 1712918400,
    "exp": 1712919000,
    "iss": "sentinel-iam",
    "aud": "sentinel-api"
  }
}
```

**Signing**:

- Algorithm: RS256 (RSA 2048-bit key pair)
- Key rotation: quarterly, with 2-week overlap period where both old and new keys are valid
- Public key endpoint: `GET /api/v1/.well-known/jwks.json`
- Key ID (`kid`) format: `YYYY-qN-primary` (e.g., `2026-q1-primary`)

**Validation** (performed by every API endpoint):

1. Verify JWT signature using the public key matching `kid`.
2. Verify `exp > now()`.
3. Verify `iss == "sentinel-iam"`.
4. Verify `aud == "sentinel-api"`.
5. Extract `tid` and set `app.current_tenant_id` on the database connection for RLS.
6. Extract `roles` and `clr` for in-process authorization checks.

### Refresh Token

- **Format**: `sntl_rt_<base64url(32 random bytes)>`
- **Example**: `sntl_rt_dGhpcyBpcyBhIHNhbXBsZSByZWZyZXNoIHRva2Vu`
- **Storage**: `SHA-256(token)` stored in `iam.sessions.refresh_hash`
- **Transport**: Returned in response body AND set as `Set-Cookie: sentinel_rt=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=28800`
- The raw token never persists on the server. Only the hash is stored.

### API Key Authentication

API keys use the `Authorization: Bearer sntl_ak_<key>` header. The server:

1. Extracts the key from the header.
2. Computes `SHA-256(key)`.
3. Looks up `iam.api_keys` by `key_hash`.
4. Verifies `revoked_at IS NULL` and `expires_at > now()` (if set).
5. Loads the associated user and validates their status and tenant status.
6. Builds a synthetic JWT-like context with the API key's scopes (which are a subset of the user's permissions).
7. Updates `last_used_at`.

---

## 13. Role Assignment Flow

### Step-by-Step Sequence

1. **Admin calls** `POST /api/v1/users/:id/roles` with body `{ roleId, scope?, expiresAt? }`.

2. **Authentication**: Extract JWT, validate signature and expiry.

3. **Authorization**: Check that the actor's effective permissions include `admin.role.manage`.

4. **Validate target user**: Confirm the user exists, is not deleted, and belongs to the actor's tenant (or the actor is `platform_admin`).

5. **Validate role**: Confirm the role exists. If `role.tenant_id` is set, confirm it matches the target user's tenant.

6. **Platform admin escalation check**: If the role being assigned is `platform_admin`:
   - Verify the actor also holds `platform_admin`.
   - Create a pending co-sign request (similar to break-glass).
   - Return `202 Accepted` with a `coSignId`.
   - A second platform admin must call `POST /api/v1/roles/cosign/:coSignId` within 60 seconds.
   - If the co-sign window expires, the assignment is rejected.

7. **Role conflict check**: Query existing active roles for the target user. Check against the conflict matrix:

   | Role A         | Role B         | Conflict? |
   | -------------- | -------------- | --------- |
   | auditor        | tenant_admin   | Yes       |
   | auditor        | platform_admin | Yes       |
   | field_responder| incident_commander | No (different scope) |

   If a conflict is detected, return `409 IAM_ROLE_CONFLICT`.

8. **Insert assignment**:

   ```sql
   INSERT INTO iam.user_roles (user_id, role_id, scope, granted_by, granted_at, expires_at)
   VALUES ($1, $2, $3, $4, now(), $5);
   ```

9. **Bump role version**:

   ```sql
   UPDATE iam.users SET role_version = role_version + 1 WHERE id = $1;
   ```

   Also update in Redis: `SET iam:user:role_version:{user_id} <new_version>`.

10. **Emit event**: Write `iam.role.assigned.v1` to `iam.outbox`.

11. **Schedule auto-revocation** (if `expiresAt` is set): Publish a NATS delayed message on subject `iam.role.auto_revoke` with payload `{ userRoleId }` and delivery delay of `expiresAt - now()`.

12. **Return** `201 Created`.

---

## 14. Permission Check Flow (PDP)

### In-Process PDP Architecture

In the NestJS modular monolith, the PDP is an injectable service (`PolicyDecisionPointService`) that other modules call directly:

```typescript
@Injectable()
export class PolicyDecisionPointService {
  async check(
    subject: PdpSubject,
    action: string,
    resource: PdpResource,
  ): Promise<PdpDecision> { /* ... */ }
}

interface PdpSubject {
  id: string;
  tenantId: string;
  clearance: number;
  roles: string[];
  attributes: Record<string, unknown>;
  roleVersion: number;
}

interface PdpResource {
  type: string;
  id: string;
  tenantId: string;
  classification?: number;
  ownerId?: string;
  [key: string]: unknown;
}

interface PdpDecision {
  decision: 'allow' | 'deny';
  obligations: string[];
  matchedPolicy?: { id: string; name: string; effect: string };
}
```

### Evaluation Sequence

1. **Module calls PDP**: e.g., `this.pdp.check(subject, 'incident.update.status', resource)`.

2. **Build evaluation context**:

   ```typescript
   const context = {
     subject: {
       id: subject.id,
       tenant_id: subject.tenantId,
       clearance: subject.clearance,
       roles: subject.roles,
       attributes: subject.attributes,
     },
     action: 'incident.update.status',
     resource: {
       type: 'incident',
       id: resource.id,
       tenant_id: resource.tenantId,
       classification: resource.classification,
       owner_id: resource.ownerId,
     },
     env: {
       time: new Date().toISOString(),
       ip: requestContext.ip,
     },
   };
   ```

3. **Check Redis cache**:

   Key: `pdp:${subject.id}:${subject.roleVersion}:${policyVersion}:${action}:${resource.id}`

   If cache hit, return the cached decision immediately.

4. **Load applicable policies** (from in-memory cache, refreshed when `policy_version` changes):

   ```sql
   SELECT * FROM iam.policies
   WHERE tenant_id = $1
     AND deleted_at IS NULL
   ORDER BY priority ASC;
   ```

   Filter to policies whose `actions` array matches the requested action (supporting glob patterns) and whose `resources` array matches the resource identifier.

5. **Evaluate policies in priority order**:

   ```
   for each policy in sorted_policies:
     if action_matches(policy.actions, context.action)
       AND resource_matches(policy.resources, context.resource)
       AND condition_matches(policy.condition, context):

       if policy.effect == 'deny':
         return { decision: 'deny', obligations: [], matchedPolicy: policy }

       if policy.effect == 'allow':
         remember this as best_allow = policy
         collect obligations from policy

   if best_allow:
     return { decision: 'allow', obligations, matchedPolicy: best_allow }

   // Default deny -- no matching policy
   return { decision: 'deny', obligations: [] }
   ```

   Key rule: **deny always wins over allow at the same or higher priority**.

6. **RBAC fallback**: If no ABAC policies match, fall back to RBAC check:

   ```
   user_permissions = union of all permissions from user's roles (including hierarchy inheritance)
   if action IN user_permissions:
     return { decision: 'allow', obligations: [] }
   else:
     return { decision: 'deny', obligations: [] }
   ```

7. **Cache the result** in Redis with 30-second TTL:

   ```
   SET pdp:${subject.id}:${subject.roleVersion}:${policyVersion}:${action}:${resource.id}
       <serialized decision>
       EX 30
   ```

   If `policyVersion` has changed between load and cache write (detected via Redis CAS), discard the stale result and re-evaluate.

8. **Return decision**. If `deny`: the calling controller returns HTTP 403 and an audit event is emitted.

### Obligations

Obligations are non-blocking side effects attached to allow decisions:

| Obligation          | Effect                                                    |
| ------------------- | --------------------------------------------------------- |
| `log_access`        | Emit an audit event for this access (used for SECRET resources) |
| `notify_supervisor` | Send a notification to the user's supervisor              |
| `time_limited`      | Access is valid only for the duration of a break-glass session |

---

## 15. Edge Cases

### Failure Scenarios

#### Database Unavailable During Login

- Return HTTP 503 with `Retry-After: 5` header.
- Never cache credentials on the client side.
- The login endpoint has a 5-second database query timeout. If exceeded, the request fails fast.

#### Redis Unavailable for PDP Cache

- Fall back to direct database policy evaluation (slower but correct).
- Log a warning at `WARN` level with metric increment for monitoring.
- No degradation of security posture -- all policies are still evaluated, just without caching.

#### NATS Unavailable When Emitting Events

- The transactional outbox pattern (`iam.outbox` table) ensures events are persisted in the same database transaction as the state change.
- A background poller (`OutboxPublisherService`) reads unpublished events every 1 second and publishes them to NATS.
- If NATS is down, events accumulate in the outbox and are delivered when NATS recovers.
- Session creation is not blocked by event delivery failure.

#### MFA Service Timeout

- If TOTP validation takes longer than 3 seconds (should not happen as it is a CPU-only operation), return HTTP 503.
- If WebAuthn assertion verification times out (network call to attestation service), return HTTP 503.
- For users where MFA is mandatory (clearance >= 3, admin roles), the server never issues tokens without MFA. There is no fallback.

#### Argon2 Computation Spike Under Load

- Argon2id hashing runs in a bounded thread pool of 4 worker threads (configurable via `IAM_ARGON2_POOL_SIZE`).
- If all threads are busy, incoming password verification requests queue up to a maximum of 100.
- If the queue overflows, return HTTP 503 with `Retry-After: 2`.
- This prevents argon2 from consuming all CPU and starving other services in the monolith.

### Concurrency Issues

#### Two Admins Assign Conflicting Roles Simultaneously

- The `UNIQUE INDEX idx_user_roles_active ON iam.user_roles(user_id, role_id) WHERE revoked_at IS NULL` prevents duplicate role assignments at the database level.
- The application-level conflict check (step 7 in the role assignment flow) catches logical conflicts (e.g., auditor + tenant_admin).
- Both checks run within a `SERIALIZABLE` or `READ COMMITTED` transaction with a `SELECT ... FOR UPDATE` on the user row to serialize concurrent role modifications.

#### Session Revocation Race

- Redis pub/sub is fire-and-forget. If the WebSocket gateway misses a revocation message (e.g., during a brief disconnect), the session still expires when the access token's 10-minute TTL lapses.
- Defense in depth: the Realtime Gateway also polls `iam:session:revoked:{user_id}` every 30 seconds for any missed messages.

#### Policy Update During Evaluation

- The PDP reads a snapshot of policies at the start of evaluation. The snapshot is identified by `policyVersion`.
- When writing the result to the Redis cache, the PDP checks the current `policyVersion` in Redis.
- If it has changed (another policy update occurred during evaluation), the stale result is discarded and the PDP re-evaluates with fresh policies.
- This ensures no stale allow/deny decisions are cached.

#### Concurrent Password Changes

- The `users` table row is updated with an optimistic lock on `updated_at`:

  ```sql
  UPDATE iam.users
  SET password_hash = $1, updated_at = now()
  WHERE id = $2 AND updated_at = $3
  RETURNING id;
  ```

- If no rows are returned, the update is retried after re-reading the current state. Last write wins after retry.

### Race Conditions

#### Refresh Token Rotation Race

Two concurrent requests present the same refresh token (e.g., a mobile app and a web tab both auto-refresh simultaneously):

1. Request A arrives first, rotates the token (creates new session, marks old as `rotated_at = now()`).
2. Request B arrives with the same token, finds `rotated_at IS NOT NULL`.
3. Request B triggers reuse detection: ALL sessions for the user are revoked.
4. Both Request A's new session and all other sessions are invalidated.
5. The user must log in again.

This is the correct and intended behavior per OAuth 2.0 security best practices. It sacrifices convenience for security when token theft is suspected.

#### Break-Glass Co-Sign Timeout

- The co-sign deadline is stored as `cosign_deadline` in `iam.breakglass_activations`.
- If the co-sign request arrives after the 60-second window: the server checks `cosign_deadline < now()`, returns 408 `IAM_BREAKGLASS_COSIGN_TIMEOUT`.
- The activation record is updated to `status = 'denied'`.
- The user must restart the break-glass flow from scratch.
- A background job cleans up stale `pending_cosign` records older than 5 minutes.

#### Tenant Suspension During Active Sessions

1. Platform admin calls `POST /tenants/:id/suspend`.
2. Server sets `tenant.status = 'suspended'`.
3. Server executes: `UPDATE iam.sessions SET revoked_at = now() WHERE user_id IN (SELECT id FROM iam.users WHERE tenant_id = $1) AND revoked_at IS NULL`.
4. Server publishes to Redis: `PUBLISH iam:tenant:suspended:{tenant_id} {}`.
5. The Realtime Gateway subscribes to `iam:tenant:suspended:*` and disconnects all sockets for users of that tenant within 1 second.
6. Access tokens already issued remain technically valid until their 10-minute expiry. However, every API endpoint includes middleware that checks tenant status:

   ```typescript
   @Injectable()
   export class TenantStatusGuard implements CanActivate {
     async canActivate(context: ExecutionContext): Promise<boolean> {
       const tenantId = context.switchToHttp().getRequest().user.tid;
       const status = await this.redis.get(`iam:tenant:status:${tenantId}`);
       if (status === 'suspended') {
         throw new ForbiddenException({
           code: 'IAM_TENANT_SUSPENDED',
           message: 'Tenant is suspended',
         });
       }
       return true;
     }
   }
   ```

   The tenant status is cached in Redis and updated on suspension. This ensures that even with a valid access token, requests from suspended tenant users are rejected immediately.
