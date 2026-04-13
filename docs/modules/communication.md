# Communication Module -- Real-Time Messaging & Voice/Video

## 1. Purpose

The Communication module provides real-time messaging, voice calls, and video conferencing for incident coordination within the CoESCD disaster management platform. It is the primary collaboration backbone: every incident gets a dedicated chat room, responders exchange field updates, and incident commanders run voice briefings -- all within a single, persistent communication layer.

### Ownership Boundaries

Communication **owns**:

- Channels (direct, group, incident room, broadcast) and their membership
- Messages, message reactions, and message redaction lifecycle
- Slash command parsing and dispatch (`/escalate`, `/task`, `/call`, `/sitrep`, `/assign`)
- Presence state (online, away, busy, offline) per user per tenant
- Call sessions (voice/video) and call participant tracking
- mediasoup SFU worker orchestration and transport management
- Call recording initiation and file reference tracking
- Message sequence ordering (monotonic per channel via Redis)
- WebSocket room subscriptions and real-time event fan-out

Communication **does not own**:

- File storage and virus scanning (owned by the Document module; Communication stores `uuid[]` references and reacts to `file.scanned.v1`)
- Incident lifecycle (owned by the Incident module; Communication consumes incident events to auto-create/archive rooms)
- User identity and permissions (owned by IAM; Communication queries IAM PDP for authorization)
- Push notifications (owned by the Notification module; Communication emits events that Notification consumes for mobile/email delivery)
- Audit log persistence (delegates to the Audit module; Communication emits auditable events)

---

## 2. Domain Model

### Aggregates

#### Channel (Aggregate Root)

| Column      | Type        | Notes                                                                   |
| ----------- | ----------- | ----------------------------------------------------------------------- |
| id          | uuid (v7)   | PK                                                                      |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL                                             |
| kind        | text        | CHECK (kind IN ('direct','group','incident_room','broadcast')), NOT NULL |
| incident_id | uuid        | FK -> incident.incidents, nullable. NOT NULL when kind=incident_room    |
| name        | text        | 3-200 chars. NULL for DIRECT (derived from members). NOT NULL otherwise |
| topic       | text        | Optional channel topic/description, max 1000 chars                      |
| created_by  | uuid        | FK -> iam.users, NOT NULL                                               |
| created_at  | timestamptz | Default now()                                                           |
| updated_at  | timestamptz | Default now(), trigger-maintained                                       |
| archived_at | timestamptz | Nullable. Set when channel is archived. No new messages after this     |

**Invariants:**

- `incident_id` MUST be NOT NULL when `kind = 'incident_room'` and MUST be NULL for all other kinds.
- Only one `incident_room` per `incident_id` (enforced by unique partial index).
- `name` is NULL only for DIRECT channels (display name derived client-side from the two members).

#### ChannelMember (Entity)

| Column       | Type        | Notes                                                        |
| ------------ | ----------- | ------------------------------------------------------------ |
| channel_id   | uuid        | FK -> chat.channels, part of composite PK                    |
| user_id      | uuid        | FK -> iam.users, part of composite PK                        |
| role         | text        | CHECK (role IN ('member','admin')), default 'member'         |
| joined_at    | timestamptz | Default now()                                                |
| last_read_at | timestamptz | Nullable, updated by MarkAsRead. Used for unread badge count |

#### CallSession (Aggregate Root)

| Column            | Type        | Notes                                                          |
| ----------------- | ----------- | -------------------------------------------------------------- |
| id                | uuid (v7)   | PK                                                             |
| tenant_id         | uuid        | FK -> iam.tenants, NOT NULL                                    |
| channel_id        | uuid        | FK -> chat.channels, NOT NULL                                  |
| incident_id       | uuid        | FK -> incident.incidents, nullable (denormalized from channel) |
| started_by        | uuid        | FK -> iam.users, NOT NULL                                      |
| started_at        | timestamptz | Default now()                                                  |
| ended_at          | timestamptz | Nullable, set when call ends                                   |
| recording_file_id | uuid        | FK -> file.files, nullable, set when recording is finalized    |
| max_participants  | smallint    | NOT NULL, default 50                                           |

**Invariants:**

- At most one active call (where `ended_at IS NULL`) per channel (enforced by unique partial index).
- `recording_file_id` is only set after the recording file has been fully written and scanned.

#### CallParticipant (Entity)

| Column    | Type        | Notes                                                                |
| --------- | ----------- | -------------------------------------------------------------------- |
| call_id   | uuid        | FK -> call.sessions, part of composite PK                            |
| user_id   | uuid        | FK -> iam.users, part of composite PK                                |
| joined_at | timestamptz | Default now()                                                        |
| left_at   | timestamptz | Nullable, set when participant leaves or call ends                   |
| role      | text        | CHECK (role IN ('host','participant')), default 'participant'        |

#### Message (Entity, Partitioned by `created_at` Monthly)

| Column      | Type        | Notes                                                                                |
| ----------- | ----------- | ------------------------------------------------------------------------------------ |
| id          | uuid (v7)   | PK (includes timestamp component for natural ordering)                               |
| channel_id  | uuid        | FK -> chat.channels, NOT NULL                                                        |
| tenant_id   | uuid        | FK -> iam.tenants, NOT NULL (denormalized for RLS)                                   |
| author_id   | uuid        | FK -> iam.users, nullable (NULL for SYSTEM messages)                                 |
| kind        | text        | CHECK (kind IN ('text','file','system','sitrep','escalation')), NOT NULL              |
| body        | text        | NOT NULL for text/system/sitrep/escalation. Max 10000 chars                          |
| attachments | uuid[]      | References file.files, default '{}'. Max 20 items                                    |
| reply_to    | uuid        | Nullable, references another message id (thread/reply)                               |
| seq         | bigint      | NOT NULL, monotonic per channel (assigned server-side via Redis INCR)                |
| created_at  | timestamptz | NOT NULL, partition key. Default now()                                                |
| redacted_at | timestamptz | Nullable. Set when message is soft-redacted                                          |
| redacted_by | uuid        | FK -> iam.users, nullable. The user who redacted the message                         |
| redact_reason | text      | Nullable, required when redacted. Max 500 chars                                      |

**Invariants:**

- Messages are **never** hard-deleted. Redaction sets `redacted_at`, `redacted_by`, and `redact_reason`. The `body` is replaced with `[redacted]` and `attachments` cleared to `'{}'`.
- `author_id` is NULL if and only if `kind = 'system'`.
- `seq` is unique per `channel_id` and monotonically increasing. Assigned server-side; never client-supplied.

#### MessageReaction (Entity)

| Column     | Type        | Notes                                        |
| ---------- | ----------- | -------------------------------------------- |
| message_id | uuid        | FK -> chat.messages, part of composite PK    |
| user_id    | uuid        | FK -> iam.users, part of composite PK        |
| emoji      | text        | NOT NULL, max 32 chars (Unicode emoji or shortcode), part of composite PK |
| created_at | timestamptz | Default now()                                |

**Composite PK:** `(message_id, user_id, emoji)` -- a user can react with multiple different emojis but not the same emoji twice.

### Value Objects

**ChannelType**

```typescript
export enum ChannelType {
  DIRECT        = 'direct',
  GROUP         = 'group',
  INCIDENT_ROOM = 'incident_room',
  BROADCAST     = 'broadcast',
}
```

**MessageKind**

```typescript
export enum MessageKind {
  TEXT       = 'text',
  FILE       = 'file',
  SYSTEM     = 'system',
  SITREP     = 'sitrep',
  ESCALATION = 'escalation',
}
```

**CallParticipantRole**

```typescript
export enum CallParticipantRole {
  HOST        = 'host',
  PARTICIPANT = 'participant',
}
```

**PresenceStatus**

```typescript
export enum PresenceStatus {
  ONLINE  = 'online',
  AWAY    = 'away',
  BUSY    = 'busy',
  OFFLINE = 'offline',
}
```

Presence is stored in Redis (not PostgreSQL) as it is ephemeral. Key format: `presence:{tenantId}:{userId}`. TTL: 90 seconds, refreshed by heartbeat every 30 seconds. If TTL expires without heartbeat, status transitions to `offline` and a `presence:update` event is broadcast.

**SlashCommand**

```typescript
export enum SlashCommand {
  ESCALATE = '/escalate',
  TASK     = '/task',
  CALL     = '/call',
  SITREP   = '/sitrep',
  ASSIGN   = '/assign',
}
```

Slash commands are parsed server-side from `body` on message receipt. If the body starts with a recognized command prefix, the message `kind` is changed from `text` to the appropriate kind (e.g., `/sitrep` sets kind to `sitrep`, `/escalate` sets kind to `escalation`). If parsing fails (unrecognized syntax after the prefix), the message is stored as plain `text` and a warning is logged.

### Sequence Ordering

Each channel has a dedicated Redis key `chat:seq:{channelId}` initialized at 0. When a message is submitted:

1. `INCR chat:seq:{channelId}` returns the next sequence number.
2. The sequence number is stored in `message.seq`.
3. Clients use `seq` for ordering and gap detection. If a client detects a gap, it fetches the missing messages via REST.

This ensures strict ordering even under concurrent writes from multiple application instances.

---

## 3. Business Rules

### Channel Rules

| # | Rule | Enforcement |
|---|------|-------------|
| C1 | DIRECT channels have exactly 2 members. No member can be added or removed after creation. | Application layer + DB check constraint trigger |
| C2 | INCIDENT_ROOM channels are auto-created when `incident.created.v1` is consumed. The channel name is derived from the incident code and title (e.g., "EQ-2026-04-0012: M6.2 Earthquake"). | Event handler, idempotent on `incident_id` unique index |
| C3 | INCIDENT_ROOM membership is derived exclusively from incident participants. No manual add/remove. Sync triggered by `incident.participant_added.v1` and `incident.participant_removed.v1`. | Event handler, validated in command layer |
| C4 | INCIDENT_ROOM channels are auto-archived when `incident.closed.v1` is consumed. `archived_at` is set. | Event handler |
| C5 | Archived channels reject all new messages, reactions, and calls. Read-only access is preserved. | Application layer checks `archived_at IS NOT NULL` before any write |
| C6 | BROADCAST channels allow posting only by users with `shift_lead` role or above. All channel members can read. | PDP authorization check in command handler |
| C7 | GROUP channels require at least 2 members (including creator). Maximum 500 members. | Application layer validation |
| C8 | A DIRECT channel between two specific users is unique per tenant. Attempting to create a duplicate returns the existing channel. | Unique index on `(tenant_id, kind, member_pair_hash)` where kind=direct |

### Message Rules

| # | Rule | Enforcement |
|---|------|-------------|
| M1 | Messages are never hard-deleted. Soft redaction replaces body with `[redacted]`, clears attachments, and records reason + actor. | Domain method on Message entity; no DELETE operation exposed |
| M2 | Only the message author can redact their own messages. `tenant_admin` can redact any message in their tenant. | PDP policy check |
| M3 | SYSTEM messages (kind=system) have no author. They are generated by the platform in response to events (member joined, call started, etc.). | Application layer sets `author_id = NULL` and `kind = 'system'` |
| M4 | Message body max length is 10,000 characters. Attachments max 20 file references. | DTO validation |
| M5 | File attachments are stored as `uuid[]` references to Document module files. Messages with unscanned files display a placeholder until `file.scanned.v1` confirms the file is clean. If the scan fails, the attachment UUID is removed from the array and a SYSTEM message is posted. | Event handler for `file.scanned.v1` and `file.scan_failed.v1` |
| M6 | Slash commands are parsed server-side. `/escalate <reason>` creates an escalation message and emits `chat.message.posted.v1` with kind=escalation. The Incident module consumes this to trigger actual escalation. `/task <description>` emits an event consumed by the Task module. `/call` starts a call session. `/sitrep <text>` creates a sitrep message. `/assign @user <role>` emits an assignment event. | Command parser in SendMessage handler |
| M7 | If slash command parsing fails (unrecognized syntax after prefix), the message is treated as plain text (kind=text) and a warning is logged. No error returned to the user. | Application layer fallback |
| M8 | The `seq` field is assigned server-side via Redis INCR. Clients must never supply it. | DTO excludes `seq`; assigned in repository layer |

### Call Rules

| # | Rule | Enforcement |
|---|------|-------------|
| K1 | Only one active call per channel at a time. Starting a new call while one is active returns `CALL_ALREADY_ACTIVE`. | Unique partial index on `(channel_id) WHERE ended_at IS NULL` |
| K2 | Call recording is automatic for incidents with severity >= HIGH (3 or 4). For lower severities, recording can be manually started by the incident commander. | Application layer checks incident severity on call start |
| K3 | Maximum participants per call defaults to 50. Exceeding this returns `CALL_CAPACITY_EXCEEDED`. | Application layer count check before join |
| K4 | When a call ends, all participants have their `left_at` set to the call's `ended_at`. | EndCall command handler bulk-updates participants |
| K5 | The call host (starter) can end the call. If the host leaves, the next participant who joined earliest is promoted to host. If no participants remain, the call auto-ends. | Application layer role promotion logic |
| K6 | Call sessions in archived channels cannot be started. Existing calls are force-ended when a channel is archived. | ArchiveChannel handler ends active calls |

### Presence Rules

| # | Rule | Enforcement |
|---|------|-------------|
| P1 | Presence is stored in Redis with 90-second TTL. Client sends heartbeat every 30 seconds. | Redis TTL + WebSocket heartbeat handler |
| P2 | When a user disconnects from all WebSocket connections, their presence transitions to offline after TTL expiry. | Redis key expiry triggers presence:update broadcast |
| P3 | Presence is scoped to tenant. A user's presence in tenant A is independent of tenant B. | Redis key includes tenantId |

---

## 4. Use Cases

### Commands

#### CreateChannel

**Actor:** Authenticated user with `chat.create` permission
**Input:** `{ kind, name?, incidentId?, memberIds[] }`
**Flow:**

1. Validate kind-specific constraints (DIRECT: exactly 2 members; GROUP: 2-500 members; BROADCAST: requires shift_lead+).
2. For DIRECT: check if a channel already exists between the two users in this tenant. If yes, return existing channel.
3. For INCIDENT_ROOM: reject -- incident rooms are only created via event handler. Return `CHAT_INCIDENT_ROOM_MANUAL_DENIED`.
4. Insert channel + members in a single transaction.
5. Write outbox event `chat.channel.created.v1`.
6. Return channel DTO.

**Errors:** `CHAT_DIRECT_LIMIT` (DIRECT with != 2 members), `CHAT_INCIDENT_ROOM_MANUAL_DENIED`, `CHAT_BROADCAST_FORBIDDEN` (non-shift_lead creating broadcast)

#### SendMessage

**Actor:** Channel member with `chat.post` permission (or `chat.post.broadcast` for broadcast channels)
**Input:** `{ channelId, body, kind?, attachments?, replyTo? }`
**Flow:**

1. Verify channel exists, is not archived, and user is a member.
2. For BROADCAST channels: verify user has `chat.post.broadcast` permission.
3. Parse body for slash commands. If recognized, adjust `kind` and trigger side effects.
4. Assign `seq` via `INCR chat:seq:{channelId}` in Redis.
5. Insert message into partitioned `chat.messages` table within transaction.
6. Write outbox event `chat.message.posted.v1`.
7. Broadcast `message:new` via Socket.IO to all subscribers of the channel room.
8. Return message DTO with assigned `seq`.

**Errors:** `CHAT_CHANNEL_NOT_FOUND`, `CHAT_CHANNEL_ARCHIVED`, `CHAT_BROADCAST_FORBIDDEN`

#### RedactMessage

**Actor:** Message author (own messages) or tenant_admin (any message)
**Input:** `{ messageId, reason }`
**Flow:**

1. Load message. Verify it exists and is not already redacted.
2. Verify authorization: author can redact own, tenant_admin can redact any within tenant.
3. Set `redacted_at = now()`, `redacted_by = actorId`, `redact_reason = reason`.
4. Replace `body` with `[redacted]`, clear `attachments` to `'{}'`.
5. Write outbox event `chat.message.redacted.v1`.
6. Broadcast `message:redacted` via Socket.IO.

**Errors:** `CHAT_MESSAGE_NOT_FOUND`, `CHAT_REDACTION_DENIED`, `CHAT_MESSAGE_ALREADY_REDACTED`

#### ReactToMessage

**Actor:** Channel member
**Input:** `{ messageId, emoji }`
**Flow:**

1. Verify message exists, channel is not archived, user is a member.
2. Upsert reaction (idempotent -- if already exists, no-op).
3. Broadcast `message:reaction` via Socket.IO.

**Errors:** `CHAT_MESSAGE_NOT_FOUND`, `CHAT_CHANNEL_ARCHIVED`

#### RemoveReaction

**Actor:** Reaction owner
**Input:** `{ messageId, emoji }`
**Flow:**

1. Delete reaction row where `(message_id, user_id, emoji)` matches.
2. Broadcast `message:reaction` via Socket.IO with `action: 'removed'`.

#### MarkAsRead

**Actor:** Channel member
**Input:** `{ channelId, lastReadAt }`
**Flow:**

1. Update `chat.members SET last_read_at = :lastReadAt WHERE channel_id = :channelId AND user_id = :actorId`.
2. `last_read_at` can only move forward (application layer enforces `new >= existing`).

#### CreateCallSession

**Actor:** User with `call.start` permission, must be a channel member
**Input:** `{ channelId }`
**Flow:**

1. Verify channel is not archived.
2. Verify no active call exists on this channel.
3. Insert call session with `started_by = actorId`.
4. Insert call participant with `role = 'host'`.
5. If channel is an incident_room, check incident severity. If severity >= HIGH, auto-enable recording.
6. Initialize mediasoup Router for this call session.
7. Write outbox event `call.started.v1`.
8. Post SYSTEM message: `"{user.fullName} started a call"`.
9. Broadcast `call:participant_joined` via Socket.IO.

**Errors:** `CHAT_CHANNEL_NOT_FOUND`, `CHAT_CHANNEL_ARCHIVED`, `CALL_ALREADY_ACTIVE`

#### JoinCall

**Actor:** Channel member with `call.join` permission
**Input:** `{ callId }`
**Flow:**

1. Verify call exists and is active (`ended_at IS NULL`).
2. Verify participant count < `max_participants`.
3. Insert call participant (idempotent -- if rejoining after disconnect, update `left_at = NULL`).
4. Create mediasoup WebRTC transport for participant.
5. Write outbox event `call.joined.v1`.
6. Broadcast `call:participant_joined`.

**Errors:** `CALL_NOT_FOUND`, `CALL_ALREADY_ENDED`, `CALL_CAPACITY_EXCEEDED`

#### LeaveCall

**Actor:** Call participant
**Input:** `{ callId }`
**Flow:**

1. Set `left_at = now()` on participant record.
2. Close mediasoup transport for participant.
3. If participant was host, promote next-earliest joiner to host. If no participants remain, trigger EndCall.
4. Write outbox event `call.left.v1`.
5. Broadcast `call:participant_left`.

**Errors:** `CALL_NOT_FOUND`

#### EndCall

**Actor:** Call host or incident_commander+
**Input:** `{ callId }`
**Flow:**

1. Set `ended_at = now()` on call session.
2. Bulk-update all participants: `SET left_at = ended_at WHERE left_at IS NULL`.
3. Close mediasoup Router (tears down all transports).
4. If recording was active, finalize recording file. Set `recording_file_id` once file is written.
5. Write outbox event `call.ended.v1`.
6. Post SYSTEM message: `"Call ended ({duration})"`.
7. Broadcast `call:ended`.

**Errors:** `CALL_NOT_FOUND`, `CALL_ALREADY_ENDED`

#### ArchiveChannel

**Actor:** tenant_admin or system (via event handler for incident closure)
**Input:** `{ channelId, reason? }`
**Flow:**

1. Set `archived_at = now()`.
2. End any active call on the channel (delegates to EndCall).
3. Post SYSTEM message: `"Channel archived"`.
4. Write outbox event `chat.channel.archived.v1`.
5. Force-unsubscribe all connected WebSocket clients from the channel room.

#### SyncIncidentRoomMembers

**Actor:** System (triggered by incident participant events)
**Input:** `{ incidentId, userId, action: 'add' | 'remove' }`
**Flow:**

1. Find INCIDENT_ROOM channel for the given `incidentId`.
2. If `action = 'add'`: insert channel member with role `member`. Post SYSTEM message: `"{user.fullName} joined the incident room"`.
3. If `action = 'remove'`: delete channel member row. Post SYSTEM message: `"{user.fullName} left the incident room"`. Force-unsubscribe user's WebSocket connections from the channel room.

### Queries

#### ListChannels

**Input:** `{ tenantId, userId, kind?, includeArchived? }`
**Output:** Paginated list of channels the user is a member of, with last message preview and unread count.

```sql
SELECT c.*, cm.last_read_at,
       (SELECT count(*) FROM chat.messages m
        WHERE m.channel_id = c.id
          AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
          AND m.redacted_at IS NULL) AS unread_count,
       (SELECT row_to_json(msg) FROM (
            SELECT id, body, kind, author_id, created_at
            FROM chat.messages
            WHERE channel_id = c.id AND redacted_at IS NULL
            ORDER BY seq DESC LIMIT 1
       ) msg) AS last_message
FROM chat.channels c
JOIN chat.members cm ON cm.channel_id = c.id AND cm.user_id = :userId
WHERE c.tenant_id = :tenantId
  AND (:kind IS NULL OR c.kind = :kind)
  AND (:includeArchived OR c.archived_at IS NULL)
ORDER BY COALESCE(
    (SELECT created_at FROM chat.messages WHERE channel_id = c.id ORDER BY seq DESC LIMIT 1),
    c.created_at
) DESC
LIMIT :limit OFFSET :offset;
```

#### GetChannel

**Input:** `{ channelId }`
**Output:** Channel detail with member list, active call info.

#### ListMessages (Cursor-Paginated)

**Input:** `{ channelId, cursor? (seq), direction: 'before' | 'after', limit (default 50, max 200) }`
**Output:** Ordered list of messages with author info and reaction counts.

```sql
SELECT m.*, 
       json_agg(DISTINCT jsonb_build_object('emoji', r.emoji, 'count', r.cnt, 'users', r.users)) 
           FILTER (WHERE r.emoji IS NOT NULL) AS reactions
FROM chat.messages m
LEFT JOIN LATERAL (
    SELECT emoji, count(*) AS cnt, array_agg(user_id) AS users
    FROM chat.reactions
    WHERE message_id = m.id
    GROUP BY emoji
) r ON true
WHERE m.channel_id = :channelId
  AND m.tenant_id = :tenantId
  AND (:cursor IS NULL OR m.seq < :cursor)  -- for direction='before'
ORDER BY m.seq DESC
LIMIT :limit;
```

#### SearchMessages

**Input:** `{ tenantId, query, channelId?, kind?, fromUserId?, dateFrom?, dateTo?, limit, offset }`
**Output:** Messages matching full-text search. Uses `tsvector` index on `body`.

```sql
SELECT m.id, m.channel_id, m.body, m.kind, m.author_id, m.created_at,
       ts_rank(to_tsvector('english', m.body), plainto_tsquery('english', :query)) AS rank
FROM chat.messages m
JOIN chat.members cm ON cm.channel_id = m.channel_id AND cm.user_id = :userId
WHERE m.tenant_id = :tenantId
  AND m.redacted_at IS NULL
  AND to_tsvector('english', m.body) @@ plainto_tsquery('english', :query)
  AND (:channelId IS NULL OR m.channel_id = :channelId)
  AND (:kind IS NULL OR m.kind = :kind)
  AND (:fromUserId IS NULL OR m.author_id = :fromUserId)
  AND (:dateFrom IS NULL OR m.created_at >= :dateFrom)
  AND (:dateTo IS NULL OR m.created_at <= :dateTo)
ORDER BY rank DESC, m.created_at DESC
LIMIT :limit OFFSET :offset;
```

#### GetUnreadCounts

**Input:** `{ tenantId, userId }`
**Output:** Map of `channelId -> unreadCount` for all channels the user is a member of.

```sql
SELECT cm.channel_id,
       count(m.id) AS unread_count
FROM chat.members cm
JOIN chat.messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.redacted_at IS NULL
WHERE cm.user_id = :userId
  AND EXISTS (
      SELECT 1 FROM chat.channels c
      WHERE c.id = cm.channel_id AND c.tenant_id = :tenantId AND c.archived_at IS NULL
  )
GROUP BY cm.channel_id;
```

#### ListCallSessions

**Input:** `{ channelId?, incidentId?, active?, limit, cursor }`
**Output:** Paginated list of call sessions with participant count.

#### GetCallSession

**Input:** `{ callId }`
**Output:** Call session detail with participant list and mediasoup transport info (for active calls).

#### GetPresence

**Input:** `{ tenantId, userIds[] }`
**Output:** Map of `userId -> PresenceStatus`. Reads from Redis multi-GET.

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsUUID, IsArray, ArrayMaxSize,
  ArrayMinSize, MaxLength, Length, IsInt, Min, Max, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Channel DTOs ─────────────────────────────────────────

export class CreateChannelDto {
  @IsEnum(ChannelType)
  kind: ChannelType;

  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  topic?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  memberIds: string[];
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  topic?: string;
}

export class ArchiveChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ── Message DTOs ─────────────────────────────────────────

export class SendMessageDto {
  @IsString()
  @MaxLength(10000)
  body: string;

  @IsOptional()
  @IsEnum(MessageKind)
  kind?: MessageKind; // defaults to TEXT; overridden by slash command parsing

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  attachments?: string[];

  @IsOptional()
  @IsUUID()
  replyTo?: string;
}

export class RedactMessageDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class ReactToMessageDto {
  @IsString()
  @MaxLength(32)
  emoji: string;
}

export class MarkAsReadDto {
  @IsString()
  lastReadAt: string; // ISO 8601 timestamp
}

// ── Message Query DTOs ───────────────────────────────────

export class ListMessagesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cursor?: number; // seq value

  @IsOptional()
  @IsEnum(['before', 'after'])
  direction?: 'before' | 'after'; // default 'before'

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number; // default 50
}

export class SearchMessagesQueryDto {
  @IsString()
  @Length(2, 500)
  query: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsEnum(MessageKind)
  kind?: MessageKind;

  @IsOptional()
  @IsUUID()
  fromUserId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

// ── Call DTOs ────────────────────────────────────────────

export class CreateCallSessionDto {
  @IsUUID()
  channelId: string;
}

// ── Response DTOs ────────────────────────────────────────

export class ChannelResponseDto {
  id: string;
  tenantId: string;
  kind: ChannelType;
  incidentId: string | null;
  name: string | null;
  topic: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  members: ChannelMemberDto[];
  lastMessage: MessageSummaryDto | null;
  unreadCount: number;
  activeCall: CallSessionSummaryDto | null;
}

export class ChannelMemberDto {
  userId: string;
  role: string;
  joinedAt: string;
  lastReadAt: string | null;
}

export class MessageResponseDto {
  id: string;
  channelId: string;
  authorId: string | null;
  kind: MessageKind;
  body: string;
  attachments: string[];
  replyTo: string | null;
  seq: number;
  createdAt: string;
  redactedAt: string | null;
  reactions: ReactionSummaryDto[];
}

export class MessageSummaryDto {
  id: string;
  body: string;
  kind: MessageKind;
  authorId: string | null;
  createdAt: string;
}

export class ReactionSummaryDto {
  emoji: string;
  count: number;
  users: string[];
}

export class CallSessionResponseDto {
  id: string;
  tenantId: string;
  channelId: string;
  incidentId: string | null;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  recordingFileId: string | null;
  participants: CallParticipantDto[];
}

export class CallSessionSummaryDto {
  id: string;
  startedBy: string;
  startedAt: string;
  participantCount: number;
}

export class CallParticipantDto {
  userId: string;
  joinedAt: string;
  leftAt: string | null;
  role: string;
}

export class UnreadCountsResponseDto {
  counts: Record<string, number>; // channelId -> count
}

export class PresenceResponseDto {
  presence: Record<string, PresenceStatus>; // userId -> status
}
```

### REST Endpoints

#### Channels

| Method | Path | Handler | Auth | Notes |
|--------|------|---------|------|-------|
| POST   | `/api/v1/channels` | CreateChannel | `chat.create` | Body: `CreateChannelDto` |
| GET    | `/api/v1/channels` | ListChannels | `chat.read` | Query: `kind?, includeArchived?` |
| GET    | `/api/v1/channels/:channelId` | GetChannel | `chat.read` + member | |
| PATCH  | `/api/v1/channels/:channelId` | UpdateChannel | `chat.update` + admin | Body: `UpdateChannelDto` |
| POST   | `/api/v1/channels/:channelId/archive` | ArchiveChannel | `chat.archive` | Body: `ArchiveChannelDto` |
| GET    | `/api/v1/channels/:channelId/members` | ListMembers | `chat.read` + member | |
| POST   | `/api/v1/channels/:channelId/members` | AddMember | `chat.members.manage` + admin | Not for DIRECT or INCIDENT_ROOM |
| DELETE | `/api/v1/channels/:channelId/members/:userId` | RemoveMember | `chat.members.manage` + admin | Not for DIRECT or INCIDENT_ROOM |

#### Messages

| Method | Path | Handler | Auth | Notes |
|--------|------|---------|------|-------|
| GET    | `/api/v1/channels/:channelId/messages` | ListMessages | `chat.read` + member | Query: `ListMessagesQueryDto` (cursor-paginated) |
| POST   | `/api/v1/channels/:channelId/messages` | SendMessage | `chat.post` + member | Body: `SendMessageDto` |
| POST   | `/api/v1/channels/:channelId/messages/:messageId/redact` | RedactMessage | `chat.redact` | Body: `RedactMessageDto` |
| POST   | `/api/v1/channels/:channelId/messages/:messageId/reactions` | ReactToMessage | `chat.post` + member | Body: `ReactToMessageDto` |
| DELETE | `/api/v1/channels/:channelId/messages/:messageId/reactions/:emoji` | RemoveReaction | member | Only own reactions |
| POST   | `/api/v1/channels/:channelId/read` | MarkAsRead | member | Body: `MarkAsReadDto` |
| GET    | `/api/v1/messages/search` | SearchMessages | `chat.read` | Query: `SearchMessagesQueryDto` |
| GET    | `/api/v1/channels/unread-counts` | GetUnreadCounts | authenticated | Returns all unread counts for user |

#### Calls

| Method | Path | Handler | Auth | Notes |
|--------|------|---------|------|-------|
| POST   | `/api/v1/calls` | CreateCallSession | `call.start` + member | Body: `CreateCallSessionDto` |
| GET    | `/api/v1/calls/:callId` | GetCallSession | `call.join` + member | |
| GET    | `/api/v1/channels/:channelId/calls` | ListCallSessions | `chat.read` + member | Query: `active?, limit, cursor` |
| POST   | `/api/v1/calls/:callId/end` | EndCall | call host or IC+ | |

#### Presence

| Method | Path | Handler | Auth | Notes |
|--------|------|---------|------|-------|
| GET    | `/api/v1/presence` | GetPresence | authenticated | Query: `userIds[]` (max 100) |

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `CHAT_CHANNEL_NOT_FOUND` | 404 | Channel does not exist or user lacks access |
| `CHAT_CHANNEL_ARCHIVED` | 409 | Channel is archived; write operations rejected |
| `CHAT_MESSAGE_NOT_FOUND` | 404 | Message does not exist in the specified channel |
| `CHAT_BROADCAST_FORBIDDEN` | 403 | User lacks `chat.post.broadcast` permission |
| `CHAT_DIRECT_LIMIT` | 400 | DIRECT channel requires exactly 2 members |
| `CHAT_REDACTION_DENIED` | 403 | User is neither the author nor a tenant_admin |
| `CHAT_MESSAGE_ALREADY_REDACTED` | 409 | Message has already been redacted |
| `CHAT_INCIDENT_ROOM_MANUAL_DENIED` | 403 | INCIDENT_ROOM channels cannot be created manually |
| `CHAT_INCIDENT_ROOM_MEMBER_MANUAL` | 403 | INCIDENT_ROOM membership is managed by incident module |
| `CHAT_MEMBER_ALREADY_EXISTS` | 409 | User is already a member of the channel |
| `CHAT_GROUP_MEMBER_LIMIT` | 400 | GROUP channel exceeds 500 member limit |
| `CALL_NOT_FOUND` | 404 | Call session does not exist |
| `CALL_ALREADY_ENDED` | 409 | Call session has already ended |
| `CALL_ALREADY_ACTIVE` | 409 | An active call already exists on this channel |
| `CALL_CAPACITY_EXCEEDED` | 429 | Call has reached maximum participant limit |
| `CALL_START_DENIED` | 403 | User lacks `call.start` permission |

### WebSocket Events

The Communication module uses Socket.IO with namespace `/chat`. Authentication is performed via JWT in the `auth` handshake parameter. Upon connection, the server verifies the token and assigns the socket to tenant-scoped rooms.

#### Client -> Server Events

**`channel:subscribe`**

Subscribe to real-time updates for a channel. Server adds socket to the Socket.IO room `channel:{channelId}`.

```typescript
interface ChannelSubscribePayload {
  channelId: string;
}
// Acknowledgement:
interface ChannelSubscribeAck {
  ok: boolean;
  error?: string; // CHAT_CHANNEL_NOT_FOUND, CHAT_CHANNEL_ARCHIVED
}
```

**`channel:unsubscribe`**

Unsubscribe from a channel room.

```typescript
interface ChannelUnsubscribePayload {
  channelId: string;
}
```

**`message:send`**

Send a message via WebSocket (alternative to REST POST). Same validation and processing as REST endpoint.

```typescript
interface MessageSendPayload {
  channelId: string;
  body: string;
  kind?: MessageKind;
  attachments?: string[];
  replyTo?: string;
}
// Acknowledgement:
interface MessageSendAck {
  ok: boolean;
  messageId?: string;
  seq?: number;
  error?: string;
}
```

**`message:typing`**

Broadcast typing indicator to other channel subscribers. Rate-limited to 1 event per 3 seconds per user per channel.

```typescript
interface MessageTypingPayload {
  channelId: string;
}
```

**`call:join`**

Join an active call. Server creates mediasoup transport and returns transport parameters.

```typescript
interface CallJoinPayload {
  callId: string;
}
// Acknowledgement:
interface CallJoinAck {
  ok: boolean;
  transportOptions?: {
    id: string;
    iceParameters: object;
    iceCandidates: object[];
    dtlsParameters: object;
  };
  routerRtpCapabilities?: object;
  error?: string;
}
```

**`call:leave`**

Leave an active call. Server closes mediasoup transport.

```typescript
interface CallLeavePayload {
  callId: string;
}
```

**`call:produce`**

Start producing media (audio/video). Server creates a mediasoup Producer.

```typescript
interface CallProducePayload {
  callId: string;
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: object;
}
// Acknowledgement:
interface CallProduceAck {
  ok: boolean;
  producerId?: string;
  error?: string;
}
```

**`call:consume`**

Request to consume another participant's media. Server creates a mediasoup Consumer.

```typescript
interface CallConsumePayload {
  callId: string;
  producerId: string;
  rtpCapabilities: object;
}
// Acknowledgement:
interface CallConsumeAck {
  ok: boolean;
  consumerId?: string;
  producerId?: string;
  kind?: 'audio' | 'video';
  rtpParameters?: object;
  error?: string;
}
```

#### Server -> Client Events

**`message:new`**

Broadcast to all subscribers of the channel room when a new message is posted.

```typescript
interface MessageNewEvent {
  id: string;
  channelId: string;
  authorId: string | null;
  kind: MessageKind;
  body: string;
  attachments: string[];
  replyTo: string | null;
  seq: number;
  createdAt: string;
}
```

**`message:redacted`**

Broadcast when a message is redacted.

```typescript
interface MessageRedactedEvent {
  id: string;
  channelId: string;
  redactedAt: string;
  redactedBy: string;
}
```

**`message:reaction`**

Broadcast when a reaction is added or removed.

```typescript
interface MessageReactionEvent {
  messageId: string;
  channelId: string;
  userId: string;
  emoji: string;
  action: 'added' | 'removed';
}
```

**`message:typing`**

Broadcast to other channel subscribers (excluding the sender).

```typescript
interface MessageTypingEvent {
  channelId: string;
  userId: string;
}
```

**`presence:update`**

Broadcast to all tenant members when a user's presence changes.

```typescript
interface PresenceUpdateEvent {
  userId: string;
  status: PresenceStatus;
  updatedAt: string;
}
```

**`call:participant_joined`**

Broadcast to channel subscribers when a participant joins a call.

```typescript
interface CallParticipantJoinedEvent {
  callId: string;
  channelId: string;
  userId: string;
  role: string;
  joinedAt: string;
}
```

**`call:participant_left`**

Broadcast when a participant leaves a call.

```typescript
interface CallParticipantLeftEvent {
  callId: string;
  channelId: string;
  userId: string;
  leftAt: string;
}
```

**`call:ended`**

Broadcast when a call session ends.

```typescript
interface CallEndedEvent {
  callId: string;
  channelId: string;
  endedAt: string;
  durationSeconds: number;
  recordingFileId: string | null;
}
```

**`channel:archived`**

Broadcast to all channel subscribers, then force-unsubscribe all sockets from the room.

```typescript
interface ChannelArchivedEvent {
  channelId: string;
  archivedAt: string;
}
```

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes the standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "chat.message.posted.v1"
  source: string;      // "communication-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### chat.message.posted.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000001",
  "type": "chat.message.posted.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:15:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000099",
  "data": {
    "messageId": "019526b0-8a00-7000-8000-000000000010",
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "authorId": "019526a0-1000-7000-8000-000000000050",
    "kind": "text",
    "body": "Road access blocked on Highway 12. Rerouting convoy to alternate route.",
    "attachments": [],
    "replyTo": null,
    "seq": 142,
    "incidentId": "019526a0-7c00-7000-8000-000000000010"
  }
}
```

#### chat.message.redacted.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000002",
  "type": "chat.message.redacted.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:20:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000100",
  "data": {
    "messageId": "019526b0-8a00-7000-8000-000000000010",
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "redactedBy": "019526a0-1000-7000-8000-000000000050",
    "reason": "Contained sensitive personnel information"
  }
}
```

#### chat.channel.created.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000003",
  "type": "chat.channel.created.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:30:01.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000101",
  "data": {
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "kind": "incident_room",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "name": "EQ-2026-04-0012: M6.2 Earthquake - Northern Region",
    "createdBy": "system",
    "memberIds": ["019526a0-1000-7000-8000-000000000050"]
  }
}
```

#### chat.channel.archived.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000004",
  "type": "chat.channel.archived.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T18:00:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000102",
  "data": {
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "archivedAt": "2026-04-12T18:00:00.000Z"
  }
}
```

#### call.started.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000005",
  "type": "call.started.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:00:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000103",
  "data": {
    "callId": "019526b0-9000-7000-8000-000000000001",
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "startedBy": "019526a0-1000-7000-8000-000000000050",
    "recording": true
  }
}
```

#### call.joined.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000006",
  "type": "call.joined.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:00:15.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000104",
  "data": {
    "callId": "019526b0-9000-7000-8000-000000000001",
    "userId": "019526a0-1000-7000-8000-000000000051",
    "role": "participant"
  }
}
```

#### call.left.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000007",
  "type": "call.left.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:30:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000105",
  "data": {
    "callId": "019526b0-9000-7000-8000-000000000001",
    "userId": "019526a0-1000-7000-8000-000000000051",
    "leftAt": "2026-04-12T11:30:00.000Z"
  }
}
```

#### call.ended.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000008",
  "type": "call.ended.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T12:00:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000106",
  "data": {
    "callId": "019526b0-9000-7000-8000-000000000001",
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "endedAt": "2026-04-12T12:00:00.000Z",
    "durationSeconds": 3600,
    "participantCount": 8,
    "recording": true
  }
}
```

#### call.recording_ready.v1

```json
{
  "id": "019526b0-8a00-7000-8000-000000000009",
  "type": "call.recording_ready.v1",
  "source": "communication-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T12:05:00.000Z",
  "correlationId": "019526b0-8a00-7000-8000-000000000107",
  "data": {
    "callId": "019526b0-9000-7000-8000-000000000001",
    "channelId": "019526a0-5000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "recordingFileId": "019526b0-a000-7000-8000-000000000001",
    "durationSeconds": 3600,
    "fileSizeBytes": 52428800
  }
}
```

### Consumed Events

#### incident.created.v1

**Source:** incident-module
**Handler:** `OnIncidentCreated`
**Action:**

1. Create an `incident_room` channel with name `"{incidentCode}: {incidentTitle}"`.
2. Add the incident creator as the initial member with role `admin`.
3. Post SYSTEM message: `"Incident room created for {incidentCode}"`.
4. Emit `chat.channel.created.v1`.

**Idempotency:** Check `incident_id` unique index before insert. If already exists, log and skip.

#### incident.closed.v1

**Source:** incident-module
**Handler:** `OnIncidentClosed`
**Action:**

1. Find `incident_room` channel by `incident_id`.
2. End any active call on the channel.
3. Archive the channel (`archived_at = now()`).
4. Post SYSTEM message: `"Incident closed. Channel archived."`.
5. Emit `chat.channel.archived.v1`.
6. Force-unsubscribe all WebSocket clients from the channel room.

**Idempotency:** Check `archived_at IS NOT NULL` before processing. If already archived, skip.

#### incident.participant_added.v1

**Source:** incident-module
**Handler:** `OnIncidentParticipantAdded`
**Action:**

1. Find `incident_room` channel by `incident_id`.
2. Add user as member with role `member` (upsert -- idempotent).
3. Post SYSTEM message: `"{user.fullName} joined the incident room"`.

#### incident.participant_removed.v1

**Source:** incident-module
**Handler:** `OnIncidentParticipantRemoved`
**Action:**

1. Find `incident_room` channel by `incident_id`.
2. Remove user from channel members.
3. Post SYSTEM message: `"{user.fullName} left the incident room"`.
4. If user is connected via WebSocket, force-unsubscribe from channel room and emit `channel:archived` to that socket (reusing event to signal access revocation).
5. If user is in an active call on this channel, remove them from the call.

#### iam.user.deactivated.v1

**Source:** iam-module
**Handler:** `OnUserDeactivated`
**Action:**

1. Find all channels where user is a member.
2. Remove user from all channel member lists.
3. For each active call the user is participating in, trigger LeaveCall.
4. Disconnect all WebSocket connections for this user.
5. Clear presence from Redis.

**Note:** This is a tenant-scoped operation. The event includes `tenantId` and `userId`.

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schemas
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS chat;
CREATE SCHEMA IF NOT EXISTS call;

-- =============================================================================
-- chat.channels
-- =============================================================================
CREATE TABLE chat.channels (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    kind            text            NOT NULL CHECK (kind IN (
                        'direct','group','incident_room','broadcast'
                    )),
    incident_id     uuid            REFERENCES incident.incidents(id),
    name            text            CHECK (char_length(name) BETWEEN 3 AND 200),
    topic           text            CHECK (char_length(topic) <= 1000),
    created_by      uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    archived_at     timestamptz,

    -- incident_id required for incident_room, null otherwise
    CONSTRAINT chk_incident_room_incident_id CHECK (
        (kind = 'incident_room' AND incident_id IS NOT NULL) OR
        (kind != 'incident_room' AND incident_id IS NULL)
    ),
    -- name required for non-direct channels
    CONSTRAINT chk_channel_name CHECK (
        (kind = 'direct' AND name IS NULL) OR
        (kind != 'direct' AND name IS NOT NULL)
    )
);

-- One incident_room per incident
CREATE UNIQUE INDEX idx_channels_incident_id
    ON chat.channels (incident_id)
    WHERE incident_id IS NOT NULL;

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_channels_tenant_id ON chat.channels (tenant_id);

-- Kind filtering per tenant
CREATE INDEX idx_channels_tenant_kind ON chat.channels (tenant_id, kind);

-- Archived filtering
CREATE INDEX idx_channels_tenant_archived ON chat.channels (tenant_id, archived_at)
    WHERE archived_at IS NULL;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION chat.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channels_updated_at
    BEFORE UPDATE ON chat.channels
    FOR EACH ROW
    EXECUTE FUNCTION chat.update_updated_at();

-- =============================================================================
-- chat.members
-- =============================================================================
CREATE TABLE chat.members (
    channel_id      uuid            NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
    user_id         uuid            NOT NULL REFERENCES iam.users(id),
    role            text            NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
    joined_at       timestamptz     NOT NULL DEFAULT now(),
    last_read_at    timestamptz,
    PRIMARY KEY (channel_id, user_id)
);

-- User's channel list lookup
CREATE INDEX idx_members_user_id ON chat.members (user_id);

-- Unread count queries: user's last_read_at per channel
CREATE INDEX idx_members_user_channel ON chat.members (user_id, channel_id)
    INCLUDE (last_read_at, joined_at);

-- =============================================================================
-- chat.messages (PARTITIONED BY RANGE on created_at, monthly)
-- =============================================================================
CREATE TABLE chat.messages (
    id              uuid            NOT NULL DEFAULT gen_random_uuid(),
    channel_id      uuid            NOT NULL,
    tenant_id       uuid            NOT NULL,
    author_id       uuid,
    kind            text            NOT NULL CHECK (kind IN (
                        'text','file','system','sitrep','escalation'
                    )),
    body            text            NOT NULL CHECK (char_length(body) <= 10000),
    attachments     uuid[]          NOT NULL DEFAULT '{}',
    reply_to        uuid,
    seq             bigint          NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    redacted_at     timestamptz,
    redacted_by     uuid,
    redact_reason   text            CHECK (char_length(redact_reason) <= 500),

    -- system messages must have null author, others must have non-null author
    CONSTRAINT chk_message_author CHECK (
        (kind = 'system' AND author_id IS NULL) OR
        (kind != 'system' AND author_id IS NOT NULL)
    ),
    -- redaction fields must be all-or-nothing
    CONSTRAINT chk_redaction_consistency CHECK (
        (redacted_at IS NULL AND redacted_by IS NULL AND redact_reason IS NULL) OR
        (redacted_at IS NOT NULL AND redacted_by IS NOT NULL AND redact_reason IS NOT NULL)
    ),
    -- attachments max 20
    CONSTRAINT chk_attachments_limit CHECK (
        array_length(attachments, 1) IS NULL OR array_length(attachments, 1) <= 20
    ),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partition management via pg_partman
-- Creates monthly partitions automatically, pre-creates 3 months ahead
SELECT partman.create_parent(
    p_parent_table := 'chat.messages',
    p_control := 'created_at',
    p_type := 'range',
    p_interval := '1 month',
    p_premake := 3
);

-- Message pagination: channel + seq (primary query path)
CREATE INDEX idx_messages_channel_seq ON chat.messages (channel_id, seq DESC);

-- Message pagination with created_at for partition pruning
CREATE INDEX idx_messages_channel_created ON chat.messages (channel_id, created_at DESC);

-- Tenant isolation for RLS
CREATE INDEX idx_messages_tenant_id ON chat.messages (tenant_id);

-- Full-text search on message body
CREATE INDEX idx_messages_fts ON chat.messages
    USING GIN (to_tsvector('english', body));

-- Author lookup
CREATE INDEX idx_messages_author ON chat.messages (author_id, created_at DESC)
    WHERE author_id IS NOT NULL;

-- Reply thread lookup
CREATE INDEX idx_messages_reply_to ON chat.messages (reply_to)
    WHERE reply_to IS NOT NULL;

-- Sequence uniqueness per channel (within each partition)
CREATE UNIQUE INDEX idx_messages_channel_seq_unique ON chat.messages (channel_id, seq, created_at);

-- =============================================================================
-- chat.reactions
-- =============================================================================
CREATE TABLE chat.reactions (
    message_id      uuid            NOT NULL,
    user_id         uuid            NOT NULL REFERENCES iam.users(id),
    emoji           text            NOT NULL CHECK (char_length(emoji) <= 32),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- Reaction aggregation per message
CREATE INDEX idx_reactions_message ON chat.reactions (message_id);

-- =============================================================================
-- call.sessions
-- =============================================================================
CREATE TABLE call.sessions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL REFERENCES iam.tenants(id),
    channel_id          uuid            NOT NULL REFERENCES chat.channels(id),
    incident_id         uuid            REFERENCES incident.incidents(id),
    started_by          uuid            NOT NULL REFERENCES iam.users(id),
    started_at          timestamptz     NOT NULL DEFAULT now(),
    ended_at            timestamptz,
    recording_file_id   uuid,
    max_participants    smallint        NOT NULL DEFAULT 50 CHECK (max_participants BETWEEN 2 AND 200)
);

-- One active call per channel
CREATE UNIQUE INDEX idx_sessions_active_per_channel
    ON call.sessions (channel_id)
    WHERE ended_at IS NULL;

-- Tenant lookup
CREATE INDEX idx_sessions_tenant ON call.sessions (tenant_id);

-- Channel call history
CREATE INDEX idx_sessions_channel ON call.sessions (channel_id, started_at DESC);

-- Incident call history
CREATE INDEX idx_sessions_incident ON call.sessions (incident_id, started_at DESC)
    WHERE incident_id IS NOT NULL;

-- Active calls lookup
CREATE INDEX idx_sessions_active ON call.sessions (tenant_id)
    WHERE ended_at IS NULL;

-- =============================================================================
-- call.participants
-- =============================================================================
CREATE TABLE call.participants (
    call_id         uuid            NOT NULL REFERENCES call.sessions(id) ON DELETE CASCADE,
    user_id         uuid            NOT NULL REFERENCES iam.users(id),
    joined_at       timestamptz     NOT NULL DEFAULT now(),
    left_at         timestamptz,
    role            text            NOT NULL DEFAULT 'participant' CHECK (role IN ('host','participant')),
    PRIMARY KEY (call_id, user_id)
);

-- Active participants per call
CREATE INDEX idx_participants_active ON call.participants (call_id)
    WHERE left_at IS NULL;

-- User's call history
CREATE INDEX idx_participants_user ON call.participants (user_id, joined_at DESC);

-- =============================================================================
-- chat.outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE chat.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'channel',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_chat_outbox_unpublished ON chat.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE chat.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE call.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE call.participants ENABLE ROW LEVEL SECURITY;

-- Policy: channels visible to same tenant
CREATE POLICY tenant_isolation ON chat.channels
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: members — user must be in the same tenant (via channel join)
CREATE POLICY tenant_isolation ON chat.members
    USING (
        EXISTS (
            SELECT 1 FROM chat.channels c
            WHERE c.id = channel_id
              AND c.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: messages — direct tenant_id check (denormalized)
CREATE POLICY tenant_isolation ON chat.messages
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: messages — user must be a member of the channel
CREATE POLICY member_access ON chat.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat.members cm
            WHERE cm.channel_id = chat.messages.channel_id
              AND cm.user_id = current_setting('app.current_user_id')::uuid
        )
    );

-- Policy: reactions — user must be a member of the message's channel
CREATE POLICY member_access ON chat.reactions
    USING (
        EXISTS (
            SELECT 1 FROM chat.members cm
            JOIN chat.messages m ON m.id = chat.reactions.message_id
                AND m.channel_id = cm.channel_id
            WHERE cm.user_id = current_setting('app.current_user_id')::uuid
        )
    );

-- Policy: call sessions — same tenant
CREATE POLICY tenant_isolation ON call.sessions
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: call participants — user must be in the same tenant (via session join)
CREATE POLICY tenant_isolation ON call.participants
    USING (
        EXISTS (
            SELECT 1 FROM call.sessions s
            WHERE s.id = call_id
              AND s.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );
```

### Partition Maintenance

Monthly partitions are managed by `pg_partman`. Configuration:

```sql
-- Run pg_partman maintenance daily via pg_cron
SELECT cron.schedule('partman-maintenance', '0 3 * * *', $$
    SELECT partman.run_maintenance('chat.messages');
$$);
```

- **Pre-creation:** 3 months of future partitions are always pre-created.
- **Retention:** Partitions older than the tenant's data retention policy (default 24 months) are detached (not dropped). Detached partitions are archived to cold storage by the ops team.
- **Month boundary:** Messages landing exactly at midnight UTC go to the new partition. The UUIDv7 timestamp and `created_at` are assigned server-side in the same transaction, ensuring consistency.

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The Communication module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Permission | Required Role | Description |
|------------|---------------|-------------|
| `chat.create` | any authenticated user | Create DIRECT or GROUP channels |
| `chat.create.broadcast` | shift_lead+ | Create BROADCAST channels |
| `chat.read` | any authenticated user | List and read channels the user is a member of |
| `chat.read.incident` | incident participant | Read messages in an INCIDENT_ROOM (membership is automatic) |
| `chat.post` | channel member | Send messages to a channel |
| `chat.post.broadcast` | shift_lead+ | Post to BROADCAST channels |
| `chat.update` | channel admin | Update channel name/topic (GROUP and BROADCAST only) |
| `chat.archive` | tenant_admin+ | Manually archive a channel (INCIDENT_ROOM archived automatically) |
| `chat.redact` | message author OR tenant_admin | Redact a message |
| `chat.members.manage` | channel admin | Add/remove members (GROUP and BROADCAST only, not DIRECT or INCIDENT_ROOM) |
| `call.start` | incident_commander+ (for incident rooms), any member (for other channels) | Start a call session |
| `call.join` | channel member | Join an active call |
| `call.end` | call host or incident_commander+ | End a call session |
| `call.record` | auto for severity >= HIGH; incident_commander+ for manual | Start/stop call recording |

### ABAC Conditions

The following attribute-based conditions are applied in addition to role checks:

| Condition | Attributes | Applied To |
|-----------|------------|------------|
| Channel membership | `user.id IN channel.members` | All channel read/write operations |
| Broadcast posting | `user.role >= shift_lead` | `chat.post.broadcast` |
| Incident room access | `user.id IN incident.participants` | `chat.read.incident` |
| Message redaction | `message.authorId == user.id OR user.role >= tenant_admin` | `chat.redact` |
| Call recording auto-start | `incident.severity >= 3` | `call.record` |
| Classification clearance | `user.clearance >= channel.incident.classification` | All INCIDENT_ROOM operations |

### Authorization Flow

```
Client Request
    │
    ▼
Communication Module (Command Handler)
    │
    ├── 1. Extract JWT claims (tenantId, userId, roles, clearance)
    │
    ├── 2. Set PostgreSQL session variables for RLS:
    │       SET app.current_tenant_id = :tenantId
    │       SET app.current_user_id = :userId
    │       SET app.current_user_clearance = :clearance
    │
    ├── 3. Query IAM PDP for permission check:
    │       pdp.evaluate({
    │           action: 'chat.post',
    │           resource: 'channel:{channelId}',
    │           subject: { userId, tenantId, roles, clearance },
    │           context: { channelKind, incidentSeverity }
    │       })
    │
    ├── 4. If denied → return 403 with error code
    │
    └── 5. If allowed → proceed with command execution (RLS enforces tenant isolation at DB level)
```

---

## 9. Edge Cases

### Message sent to archived channel

**Scenario:** User sends a message to a channel that was archived between the time the UI loaded and the message was submitted.
**Handling:** The `SendMessage` handler checks `archived_at IS NOT NULL` before inserting. Returns `CHAT_CHANNEL_ARCHIVED` (HTTP 409). The WebSocket `message:send` acknowledgement also returns this error. The client should handle this by disabling the input field and showing a notice.

### User removed from incident while typing

**Scenario:** An incident commander removes a participant from the incident while that participant is actively typing in the incident room.
**Handling:** The `incident.participant_removed.v1` event handler removes the user from the channel and calls `socket.leave(channelRoom)` for all of the user's connected sockets. The server emits a `channel:archived` event to the user's socket (reused to signal access revocation). Any in-flight `message:send` from the user will fail the membership check and return an error in the acknowledgement. The typing indicator from the removed user naturally stops (no further heartbeats from that room).

### Call recording fails mid-call

**Scenario:** The mediasoup recording pipeline encounters an I/O error (disk full, network partition to object storage) while recording an active call.
**Handling:**

1. The recording subsystem logs the error with full context (callId, error, timestamp).
2. The call continues uninterrupted -- recording failure does not end the call.
3. A SYSTEM message is posted to the channel: `"Call recording interrupted. Attempting to resume."`.
4. The recording subsystem attempts to reconnect/resume after a 5-second backoff, up to 3 retries.
5. If all retries fail, a `call.recording_failed.v1` event is emitted (consumed by the Notification module to alert the incident commander).
6. The `recording_file_id` on the call session remains NULL. Partial recordings (if any) are preserved with a `_partial` suffix in object storage for forensic recovery.

### Concurrent message sends create ordering issues

**Scenario:** Multiple users send messages to the same channel simultaneously from different application instances.
**Handling:** The Redis `INCR chat:seq:{channelId}` operation is atomic and guarantees monotonic sequence assignment. Each message gets a unique, strictly ordered `seq` value regardless of which application instance processes it. Even if database writes complete out of order, clients use `seq` for display ordering. Clients detect gaps in `seq` and fetch missing messages via the REST `ListMessages` endpoint. The `seq` assignment and database insert are not in the same atomic boundary (Redis + PostgreSQL), but this is acceptable: if the database insert fails after `INCR`, the `seq` gap is permanent but harmless -- clients treat it as a no-op gap.

### Partition switch during month boundary

**Scenario:** A message is inserted at 2026-04-30T23:59:59.999Z and another at 2026-05-01T00:00:00.000Z.
**Handling:** `pg_partman` pre-creates the May partition well in advance (3 months ahead). PostgreSQL's partition routing uses the `created_at` value to direct the insert to the correct partition automatically. The `created_at` timestamp is assigned server-side (`DEFAULT now()`) within the transaction, ensuring deterministic partition selection. No message loss occurs. The `idx_messages_channel_seq` index spans partitions via partition-wise index scans, so pagination queries that cross month boundaries work correctly. For performance, queries that can be bounded by `created_at` ranges benefit from partition pruning.

### Large file attachment in message

**Scenario:** A user sends a message with an attachment that references a file currently being uploaded/scanned by the Document module.
**Handling:**

1. The message is inserted immediately with the file UUID in `attachments`.
2. The client renders a placeholder (spinner/icon) for unscanned files by checking the file's `scanned` status via the Document module API.
3. When the Document module emits `file.scanned.v1` (clean), the Communication module broadcasts an update via Socket.IO so clients replace the placeholder with the file preview.
4. If `file.scan_failed.v1` is received (malware detected), the Communication module removes the UUID from the message's `attachments` array and posts a SYSTEM message: `"An attachment was removed due to a security scan failure."`. The `message:new` event with updated attachments is broadcast.

### Slash command parsing failure

**Scenario:** User sends `/escalate` with no reason text, or `/assign` with a malformed user mention.
**Handling:** The slash command parser validates the syntax. If parsing fails (missing required arguments, unrecognized user mention, etc.), the message is stored as plain `kind = 'text'` with the original body (including the `/` prefix) preserved verbatim. A warning is logged server-side with the parsing error details. No error is returned to the user -- the message appears as regular text. This prevents message loss while allowing the user to see what they typed.

### mediasoup worker crash

**Scenario:** A mediasoup worker process crashes due to a segfault, OOM, or unhandled exception.
**Handling:**

1. The mediasoup `workerDied` event fires in the Node.js process.
2. The Communication module immediately spawns a replacement worker.
3. All Routers (calls) on the dead worker are marked as failed.
4. For each affected call, the server broadcasts `call:participant_left` for all participants (they are briefly disconnected).
5. A new Router is created on the replacement worker (or another available worker).
6. The server broadcasts a `call:reconnect` event to all affected participants with the new Router's RTP capabilities.
7. Clients automatically re-negotiate transports (re-join). The brief interruption is typically 2-5 seconds.
8. If the replacement worker also crashes within 60 seconds, the call is force-ended and a `call.ended.v1` event with `reason: 'worker_failure'` is emitted.
9. A SYSTEM message is posted: `"Call was interrupted due to a technical issue. Please rejoin."`.

### DIRECT channel deduplication

**Scenario:** Two users simultaneously try to create a DIRECT channel with each other.
**Handling:** The `CreateChannel` handler for DIRECT channels computes a deterministic `member_pair_hash` (sorted UUIDs concatenated and hashed). A unique partial index on `(tenant_id, kind, member_pair_hash) WHERE kind = 'direct'` prevents duplicates. On conflict, the existing channel is returned. Both concurrent requests succeed -- one creates, the other finds existing.

Implementation detail for the deduplication index:

```sql
-- Add member_pair_hash column for DIRECT channel deduplication
ALTER TABLE chat.channels ADD COLUMN member_pair_hash text;

CREATE UNIQUE INDEX idx_channels_direct_pair
    ON chat.channels (tenant_id, member_pair_hash)
    WHERE kind = 'direct' AND archived_at IS NULL;
```

The hash is computed as: `md5(least(userId1, userId2) || greatest(userId1, userId2))`.

### User sends message just as they are deactivated

**Scenario:** A message is in-flight via WebSocket at the exact moment `iam.user.deactivated.v1` is processed.
**Handling:** The deactivation handler disconnects all WebSocket connections for the user. Any in-flight message that arrives after disconnection is dropped (socket no longer exists). If the message was already received by the server but not yet persisted, the `SendMessage` handler checks user active status as part of the membership validation -- deactivated users are removed from all channels by the event handler, so the membership check fails. No message from a deactivated user can be persisted.

### Channel with no remaining members

**Scenario:** All members of a GROUP channel leave or are deactivated.
**Handling:** The channel remains in the database but becomes effectively dormant. No automatic deletion occurs. The channel can be re-populated by a tenant_admin. If the last admin leaves, the channel has no admin and cannot be managed -- a tenant_admin can intervene via the admin API to assign a new admin or archive the channel.
