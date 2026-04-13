# Notification Module -- Multi-Channel Delivery & Alerting

## 1. Purpose

The Notification module is the multi-channel delivery engine of the CoESCD disaster management platform. It consumes domain events from all other modules, evaluates configurable notification rules, and dispatches alerts through multiple delivery channels to ensure operational personnel receive timely, actionable information during incident response.

Every operational event -- incident creation, severity escalation, task assignment, SLA breach, document review request, chat mention, break-glass activation -- flows through this module. The notification module is the single point of responsibility for deciding who gets notified, how, and when.

### Ownership Boundaries

Notification **owns**:

- Notification rules (event-to-notification mapping with conditions and channel selection)
- Notification records (the individual notification instances sent to users)
- Delivery records and channel-specific tracking (sent, delivered, failed, read)
- User notification preferences (per-channel toggles, quiet hours, muted rules)
- Notification templates (Handlebars-style templates per channel)
- Device registration (FCM/APNs push tokens per user per device)
- Digest aggregation (batching low-priority notifications into periodic summaries)
- Rate limiting per user per channel
- Channel fallback logic (push -> SMS -> voice TTS for CRITICAL)
- Siren integration (external API calls to physical siren systems)

Notification **does not own**:

- User identity and permissions (owned by IAM; notification queries IAM for user lookups and role resolution)
- Incidents, tasks, documents, chat (owned by their respective modules; notification consumes their events)
- Email infrastructure (uses configured SMTP gateway; does not own the mail server)
- SMS infrastructure (uses configured SMS gateway API; does not own the telecom provider)
- Push infrastructure (uses FCM/APNs SDKs; does not own the push services)
- Voice infrastructure (uses configured TTS/voice gateway API; does not own the telephony provider)
- Siren hardware (calls external siren system API; does not own the physical devices)

### Key Principles

1. **Idempotent on event_id:** The same event never fires the same rule twice. Enforced by a Redis SET check followed by a database unique constraint on `(event_id, rule_id)`.
2. **CRITICAL severity broadcasts cannot be suppressed:** User preferences, quiet hours, and muted rules are ignored for notifications triggered by CRITICAL (severity 4) events. Every user in the tenant receives the alert.
3. **Channel fallback for CRITICAL:** If push delivery fails for a CRITICAL notification, the system automatically falls back to SMS. If SMS fails, it falls back to voice TTS.
4. **Rate limiting protects users:** Per-user per-channel rate limits prevent notification storms from overwhelming users or exhausting channel quotas.
5. **Digest aggregation:** Low-priority notifications (priority 4) are batched into 15-minute digest summaries rather than delivered individually.

---

## 2. Domain Model

### Aggregates

#### NotificationRule (Aggregate Root)

| Column       | Type         | Notes                                                                              |
| ------------ | ------------ | ---------------------------------------------------------------------------------- |
| id           | uuid (v7)    | PK                                                                                 |
| tenant_id    | uuid         | FK -> iam.tenants, NOT NULL                                                        |
| name         | text         | 3-200 chars, NOT NULL, human-readable label                                        |
| description  | text         | Max 2000 chars, nullable                                                           |
| event_type   | text         | NOT NULL, e.g. 'incident.severity_changed.v1'                                      |
| condition    | jsonb        | NOT NULL DEFAULT '{}', filter on event data (e.g. `{"data.after": 4}`)             |
| channels     | text[]       | NOT NULL, CHECK all elements IN ('in_app','push','sms','email','voice','siren')    |
| template_code| text         | NOT NULL, FK (logical) to notif.templates.code                                     |
| priority     | smallint     | NOT NULL CHECK (priority BETWEEN 1 AND 4), 1=critical, 4=low                       |
| is_active    | boolean      | NOT NULL DEFAULT true                                                              |
| created_by   | uuid         | FK -> iam.users, NOT NULL, immutable                                               |
| created_at   | timestamptz  | Default now()                                                                      |
| updated_at   | timestamptz  | Default now(), trigger-maintained                                                  |

**Condition JSONB Structure:**

The `condition` field uses a simple predicate language evaluated against the event envelope's `data` object:

```json
{
  "data.after": 4,
  "data.category": { "$in": ["earthquake", "flood"] },
  "data.severity": { "$gte": 3 }
}
```

Supported operators: exact match (implicit `$eq`), `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists`. Nested paths use dot notation. An empty condition `{}` matches all events of the specified `event_type`.

#### Notification (Aggregate Root)

| Column        | Type         | Notes                                                                             |
| ------------- | ------------ | --------------------------------------------------------------------------------- |
| id            | uuid (v7)    | PK                                                                                |
| tenant_id     | uuid         | FK -> iam.tenants, NOT NULL                                                       |
| rule_id       | uuid         | FK -> notif.rules, nullable (null for system-generated notifications)             |
| event_id      | uuid         | FK (logical) to originating event's id, NOT NULL, used for idempotency            |
| recipient_id  | uuid         | FK -> iam.users, NOT NULL                                                         |
| channel       | text         | NOT NULL CHECK (channel IN ('in_app','push','sms','email','voice','siren'))       |
| title         | text         | NOT NULL, max 500 chars, rendered from template                                   |
| body          | text         | NOT NULL, max 5000 chars, rendered from template                                  |
| data          | jsonb        | NOT NULL DEFAULT '{}', deep link URL, action buttons, metadata                    |
| status        | text         | NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','delivered','failed','read')) |
| priority      | smallint     | NOT NULL CHECK (priority BETWEEN 1 AND 4)                                          |
| sent_at       | timestamptz  | Set when channel adapter confirms send                                            |
| delivered_at  | timestamptz  | Set when delivery receipt is received (push/SMS)                                  |
| read_at       | timestamptz  | Set when user marks as read (in-app only)                                         |
| failed_reason | text         | Max 2000 chars, set on failure                                                    |
| retry_count   | smallint     | NOT NULL DEFAULT 0                                                                |
| digest_group  | text         | Nullable, set for batched digest notifications                                    |
| created_at    | timestamptz  | Default now(), partition key                                                      |

**Status transitions:**

```
pending -> queued -> sent -> delivered
                         \-> failed
pending -> queued -> failed
sent -> read (in-app channel only)
delivered -> read (in-app channel only)
```

**Data JSONB Structure (deep link + actions):**

```json
{
  "deepLink": "/incidents/019526a0-7c00-7000-8000-000000000010",
  "actions": [
    { "label": "View Incident", "url": "/incidents/019526a0-7c00-7000-8000-000000000010" },
    { "label": "Acknowledge", "url": "/api/v1/notifications/019526a0-8000-7000-8000-000000000001/read", "method": "POST" }
  ],
  "incidentId": "019526a0-7c00-7000-8000-000000000010",
  "incidentCode": "EQ-2026-04-0012",
  "severity": 4
}
```

#### NotificationPreference (Entity, per user per channel)

| Column            | Type         | Notes                                                                 |
| ----------------- | ------------ | --------------------------------------------------------------------- |
| user_id           | uuid         | FK -> iam.users, part of composite PK                                 |
| channel           | text         | Part of composite PK, CHECK (channel IN ('in_app','push','sms','email','voice')) |
| enabled           | boolean      | NOT NULL DEFAULT true                                                 |
| quiet_hours_start | time         | Nullable, e.g. '22:00:00' (user's local timezone)                    |
| quiet_hours_end   | time         | Nullable, e.g. '07:00:00' (user's local timezone)                    |
| timezone          | text         | NOT NULL DEFAULT 'UTC', IANA timezone identifier                      |
| muted_rules       | uuid[]       | NOT NULL DEFAULT '{}', array of rule IDs to suppress                  |
| updated_at        | timestamptz  | Default now()                                                         |

**Composite PK:** `(user_id, channel)`

**Note:** Siren channel has no user preference -- it is always controlled at the rule/system level. Voice channel preferences exist but are overridden for CRITICAL.

#### NotificationTemplate (Entity)

| Column           | Type         | Notes                                                                 |
| ---------------- | ------------ | --------------------------------------------------------------------- |
| code             | text         | Part of composite PK, e.g. 'incident_severity_critical'              |
| tenant_id        | uuid         | Part of composite PK, FK -> iam.tenants                               |
| channel          | text         | Part of composite PK, CHECK (channel IN ('in_app','push','sms','email','voice','siren')) |
| subject_template | text         | Nullable (not used by push/sms), max 500 chars, Handlebars syntax    |
| body_template    | text         | NOT NULL, max 10000 chars, Handlebars syntax                          |
| variables        | jsonb        | NOT NULL, JSON Schema describing expected variables                   |
| created_at       | timestamptz  | Default now()                                                         |
| updated_at       | timestamptz  | Default now()                                                         |

**Composite PK:** `(code, tenant_id, channel)`

**Example template:**

```handlebars
{{! Template code: incident_severity_critical, channel: push }}
{{! subject_template: }}
CRITICAL: {{incident.code}} - {{incident.title}}

{{! body_template: }}
Incident {{incident.code}} has been escalated to CRITICAL severity.
Reason: {{reason}}
Commander: {{commander.name}}
Location: {{incident.epicenter.lat}}, {{incident.epicenter.lng}}
Tap to view incident details.
```

**Variables JSON Schema:**

```json
{
  "type": "object",
  "required": ["incident", "reason"],
  "properties": {
    "incident": {
      "type": "object",
      "properties": {
        "code": { "type": "string" },
        "title": { "type": "string" },
        "severity": { "type": "integer" },
        "epicenter": {
          "type": "object",
          "properties": {
            "lat": { "type": "number" },
            "lng": { "type": "number" }
          }
        }
      }
    },
    "reason": { "type": "string" },
    "commander": {
      "type": "object",
      "properties": {
        "name": { "type": "string" }
      }
    }
  }
}
```

#### Device (Entity)

| Column       | Type         | Notes                                                                 |
| ------------ | ------------ | --------------------------------------------------------------------- |
| id           | uuid (v7)    | PK                                                                    |
| user_id      | uuid         | FK -> iam.users, NOT NULL                                             |
| tenant_id    | uuid         | FK -> iam.tenants, NOT NULL (denormalized for RLS)                    |
| token        | text         | NOT NULL, FCM/APNs token, UNIQUE                                     |
| platform     | text         | NOT NULL CHECK (platform IN ('android','ios','web'))                  |
| device_name  | text         | Nullable, human-readable label, max 200 chars                        |
| is_active    | boolean      | NOT NULL DEFAULT true                                                 |
| last_used_at | timestamptz  | Default now(), updated on each push send                              |
| created_at   | timestamptz  | Default now()                                                         |
| updated_at   | timestamptz  | Default now()                                                         |

### Value Objects

**Channel**

```typescript
export enum NotificationChannel {
  IN_APP = 'in_app',
  PUSH   = 'push',
  SMS    = 'sms',
  EMAIL  = 'email',
  VOICE  = 'voice',
  SIREN  = 'siren',
}
```

**NotificationStatus**

```typescript
export enum NotificationStatus {
  PENDING   = 'pending',
  QUEUED    = 'queued',
  SENT      = 'sent',
  DELIVERED = 'delivered',
  FAILED    = 'failed',
  READ      = 'read',
}
```

**Priority**

```typescript
export enum NotificationPriority {
  CRITICAL = 1,  // immediate delivery, all channels, bypasses preferences
  HIGH     = 2,  // immediate delivery, respects preferences
  NORMAL   = 3,  // standard delivery, respects preferences and quiet hours
  LOW      = 4,  // batched into digest every 15 minutes
}
```

**DevicePlatform**

```typescript
export enum DevicePlatform {
  ANDROID = 'android',
  IOS     = 'ios',
  WEB     = 'web',
}
```

---

## 3. Business Rules

### Idempotency

1. Before creating notifications for an event, the `ProcessEvent` worker performs a Redis `SET NX` check on key `notif:dedup:{event_id}:{rule_id}` with a TTL of 7 days.
2. If the key already exists, the event-rule pair is skipped entirely (no notification created).
3. As a secondary safeguard, the `notif.notifications` table has a unique constraint on `(event_id, rule_id, recipient_id, channel)` -- any attempt to insert a duplicate silently resolves via `ON CONFLICT DO NOTHING`.
4. The Redis TTL of 7 days aligns with the maximum event replay window in NATS JetStream.

### CRITICAL Severity Override

When a notification is triggered with `priority = 1` (CRITICAL):

1. All user preferences are bypassed -- `enabled = false`, quiet hours, and muted rules are ignored.
2. The notification is delivered on ALL channels specified by the rule, regardless of user opt-out.
3. In-app, push, SMS, and email are all dispatched simultaneously (no batching, no digest).
4. Channel fallback is activated: if push fails, SMS is attempted; if SMS fails, voice TTS is attempted.
5. Siren channel is dispatched if specified in the rule (only CRITICAL rules should include siren).

### Quiet Hours

1. Quiet hours are defined per user per channel as a `(start, end)` time range in the user's configured timezone.
2. During quiet hours, non-critical notifications (priority 2-4) are held in `queued` status for push, SMS, email, and voice channels.
3. In-app notifications are always delivered regardless of quiet hours (silent, no push wake).
4. When quiet hours end, all queued notifications are released and dispatched in a single batch.
5. A background cron job runs every minute to check for users exiting quiet hours and releases their queued notifications.
6. CRITICAL notifications (priority 1) are never subject to quiet hours.

### Channel Fallback

For CRITICAL notifications only, the following fallback chain is executed:

```
push (attempt) -> if failed -> SMS (attempt) -> if failed -> voice TTS (attempt) -> if failed -> mark as failed + alert platform_admin
```

Fallback rules:
1. Each channel attempt has a timeout: push 10s, SMS 30s, voice 60s.
2. A channel is considered "failed" if the adapter returns an error or the timeout expires.
3. If the user has no push token registered, push is skipped and SMS is attempted directly.
4. Fallback creates a new `Notification` row per channel attempt (each with its own status tracking).
5. The original notification row retains its channel and status; fallback notifications reference the original via `data.fallback_from`.

### Rate Limiting

Per-user per-channel rate limits enforced via Redis sliding window counters:

| Channel | Max per hour | Max per day | Key pattern                            |
| ------- | ------------ | ----------- | -------------------------------------- |
| push    | 60           | 500         | `notif:rate:{user_id}:push:{window}`  |
| sms     | 10           | 50          | `notif:rate:{user_id}:sms:{window}`   |
| email   | 30           | 200         | `notif:rate:{user_id}:email:{window}` |
| voice   | 5            | 20          | `notif:rate:{user_id}:voice:{window}` |
| in_app  | unlimited    | unlimited   | N/A                                    |
| siren   | N/A          | N/A         | Rate limited at siren API level        |

When a rate limit is hit:
1. The notification is held in `queued` status.
2. A Redis sorted set tracks the next available send time per user per channel.
3. A background worker picks up queued notifications when the rate window resets.
4. CRITICAL notifications (priority 1) are exempt from rate limiting.

### Template Rendering

1. Templates use Handlebars syntax: `{{variable.path}}`, `{{#if condition}}`, `{{#each list}}`.
2. Template variables are populated from the event payload merged with enriched data (user names, incident codes resolved from IDs).
3. If a template variable is missing from the context, it renders as `[missing: field_name]` and a warning is logged with the template code, channel, and missing variable name.
4. Templates are resolved by `(template_code, tenant_id, channel)`. If a tenant-specific template does not exist, the system falls back to the default tenant template (`tenant_id = '00000000-0000-0000-0000-000000000000'`).
5. Template rendering is sandboxed with a 500ms timeout to prevent runaway expressions.

### Digest Aggregation

1. Notifications with `priority = 4` (LOW) are not dispatched immediately.
2. They are collected into digest groups keyed by `{user_id}:{channel}:{15-minute-window}`.
3. Every 15 minutes, a cron job collects all pending digest notifications per user per channel.
4. A single digest notification is created with a summary body: "You have {count} new notifications" followed by a bulleted list of titles.
5. The individual notification rows are updated to `status = 'sent'` and `digest_group = {digest_notification_id}`.
6. If the digest contains only 1 notification, it is sent as a regular notification (no summary wrapper).

### Device Token Management

1. Users register push tokens via `POST /api/v1/notifications/devices`.
2. Each token is unique across the system; re-registering an existing token updates the `user_id` and `last_used_at`.
3. When FCM/APNs returns HTTP 410 (token expired) or an equivalent "not registered" error, the token is marked `is_active = false` and a `data.re_register_prompt = true` flag is set on the user's next in-app notification.
4. Inactive tokens are never used for push delivery.
5. Tokens unused for 90 days (`last_used_at` older than 90 days) are purged by a weekly cron job.
6. When a user is deactivated (`iam.user.deactivated.v1`), all their device tokens are marked `is_active = false`.

### Siren Integration

1. Siren notifications trigger an HTTP POST to the configured siren system API endpoint per tenant.
2. Siren is only permitted for CRITICAL notifications (priority 1). Any rule with `siren` channel and `priority != 1` is rejected at rule creation.
3. Siren API call has a 10-second timeout. On timeout, one retry is attempted after 5 seconds.
4. If the retry also fails, the siren notification is marked as failed and an in-app alert is sent to all `platform_admin` users: "Siren activation failed for {incident_code}. Manual activation required."
5. Siren does not have per-user semantics -- it is a broadcast to physical devices. The `recipient_id` on a siren notification is set to a sentinel value `00000000-0000-0000-0000-000000000000`.

---

## 4. Use Cases

### Commands

#### CreateRule

**Actor:** tenant_admin+
**Input:** name, description?, event_type, condition, channels[], template_code, priority, is_active?
**Flow:**

1. Validate all input fields
2. Verify `template_code` exists in `notif.templates` for the tenant (or default tenant) for all specified channels
3. If `siren` is in channels, verify `priority = 1` (CRITICAL); reject with `NOTIFICATION_SIREN_REQUIRES_CRITICAL` otherwise
4. Verify `event_type` is a known event type in the system registry
5. Set `created_by = actor.userId`
6. Persist rule
7. Return created rule

**Idempotency:** Supports `Idempotency-Key` header. If a duplicate key is received, return the previously created rule without side effects.

#### UpdateRule

**Actor:** tenant_admin+
**Input:** name?, description?, condition?, channels[]?, template_code?, priority?, is_active?
**Flow:**

1. Load rule, verify actor's tenant matches rule's tenant
2. If changing channels to include `siren`, verify priority is 1
3. If changing priority away from 1, verify channels do not include `siren`
4. If changing `template_code`, verify the new code exists for all specified channels
5. Apply changes, update `updated_at`
6. Return updated rule

#### DeleteRule

**Actor:** tenant_admin+
**Input:** rule_id
**Flow:**

1. Load rule, verify actor's tenant matches rule's tenant
2. Soft-delete the rule (set `is_active = false` and mark for deletion)
3. Existing notifications referencing this rule are not affected
4. Return 204

#### ProcessEvent (Worker -- NATS Consumer)

**Actor:** System (internal worker, no user context)
**Input:** EventEnvelope from NATS JetStream
**Flow:**

1. Parse event envelope, extract `event.id`, `event.type`, `event.tenantId`, `event.data`
2. Query all active rules matching `event_type = event.type` AND `tenant_id = event.tenantId`
3. For each matching rule:
   a. Evaluate `rule.condition` against `event.data` using the condition evaluator
   b. If condition does not match, skip this rule
   c. Check Redis dedup key `notif:dedup:{event.id}:{rule.id}` -- if exists, skip
   d. Set Redis dedup key with 7-day TTL
   e. Determine recipients based on event type and rule configuration (see recipient resolution below)
   f. For each recipient, for each channel in `rule.channels`:
      - Check idempotency: skip if `(event_id, rule_id, recipient_id, channel)` already exists in DB
      - Resolve template: load `(rule.template_code, tenant_id, channel)` from notif.templates
      - Enrich template variables: resolve user names, incident codes from IDs via cached lookups
      - Render template (subject + body)
      - Check user preferences (unless priority = 1):
        * If `channel` is disabled for user, skip
        * If `rule.id` is in user's `muted_rules`, skip
        * If user is in quiet hours for this channel, set status to `queued`
      - Check rate limit (unless priority = 1):
        * If rate limit exceeded, set status to `queued`
      - If priority = 4 (LOW), set `digest_group` key and status to `queued`
      - Create `Notification` row with rendered content
      - If status is `pending`, dispatch to channel adapter via NATS subject `notif.dispatch.{channel}`
4. ACK the NATS message

**Recipient Resolution by Event Type:**

| Event Type                           | Recipients                                                        |
| ------------------------------------ | ----------------------------------------------------------------- |
| incident.created.v1                  | All users with role `shift_lead`+ AND all `tenant_admin` users     |
| incident.severity_changed.v1 (sev=4)| ALL users in the tenant (broadcast) + siren                       |
| incident.severity_changed.v1 (sev<4)| All incident participants                                         |
| incident.status_changed.v1           | All incident participants                                         |
| incident.commander_assigned.v1       | The newly assigned commander                                      |
| task.assigned.v1                     | The assignee                                                      |
| task.sla_breached.v1                 | The assignee + the incident commander (if task is incident-linked) |
| task.completed.v1                    | The assigner (person who created/assigned the task)                |
| document.review_requested.v1        | All listed approvers                                              |
| document.approved.v1                 | The document owner                                                |
| chat.message.posted.v1              | All @mentioned users (parsed from message body)                   |
| iam.breakglass.activated.v1         | All users with role `platform_admin`                               |
| iam.user.deactivated.v1             | N/A (system action: deactivate push tokens, no notification sent)  |

#### MarkAsRead

**Actor:** notification owner (recipient_id = current user)
**Input:** notification_id
**Flow:**

1. Load notification, verify `recipient_id = actor.userId`
2. Verify `channel = 'in_app'` (only in-app notifications can be marked as read)
3. Verify status is `sent` or `delivered` (cannot mark `pending`/`failed` as read)
4. Set `status = 'read'`, `read_at = now()`
5. Publish `notification.read.v1` (for analytics)
6. Return updated notification

#### MarkAllAsRead

**Actor:** authenticated user
**Input:** none (operates on all unread in-app notifications for the user)
**Flow:**

1. Execute batch update:
   ```sql
   UPDATE notif.notifications
   SET status = 'read', read_at = now()
   WHERE recipient_id = :userId
     AND channel = 'in_app'
     AND status IN ('sent', 'delivered')
     AND tenant_id = :tenantId;
   ```
2. Return count of updated notifications
3. Invalidate Redis cache for unread count: `DEL notif:unread:{tenant_id}:{user_id}`

#### UpdatePreferences

**Actor:** authenticated user (own preferences)
**Input:** channel, enabled?, quiet_hours_start?, quiet_hours_end?, timezone?, muted_rules?
**Flow:**

1. Validate input: if `quiet_hours_start` is provided, `quiet_hours_end` must also be provided (and vice versa)
2. Upsert preference row for `(user_id, channel)`
3. If enabling quiet hours, validate timezone is a valid IANA timezone
4. If adding to `muted_rules`, verify each rule_id exists and belongs to user's tenant
5. Return updated preferences

#### RegisterDevice

**Actor:** authenticated user
**Input:** token, platform, device_name?
**Flow:**

1. Validate `platform` is one of 'android', 'ios', 'web'
2. Check if `token` already exists in `notif.devices`:
   - If it exists for a different user, update `user_id` to current user (device was transferred or re-logged)
   - If it exists for the same user, update `last_used_at` and `device_name`
   - If it does not exist, insert new row
3. Set `is_active = true`
4. Return device record

#### UnregisterDevice

**Actor:** authenticated user
**Input:** device_id
**Flow:**

1. Load device, verify `user_id = actor.userId`
2. Mark `is_active = false` (soft delete)
3. Return 204

#### SendTestNotification

**Actor:** tenant_admin+
**Input:** rule_id
**Flow:**

1. Load rule, verify actor's tenant matches
2. Create a synthetic event matching the rule's `event_type` with sample data
3. Evaluate the rule's condition against the sample event (should pass)
4. Render templates for all channels in the rule
5. Create notification(s) targeting only the requesting user (actor)
6. Dispatch through all specified channels
7. Return the test notification IDs

### Queries

#### ListNotifications

**Actor:** authenticated user (own notifications)
**Parameters:** cursor, limit (max 100, default 25), filter[status] ('unread' maps to `status IN ('sent','delivered')`), filter[channel]
**Implementation:**

- RLS automatically filters by `tenant_id`
- Additional filter: `recipient_id = current_user_id`
- Cursor-based pagination on `(created_at DESC, id DESC)`
- Redis cache for the first page of unread notifications (invalidated on new notification or read event)

```sql
SELECT id, rule_id, channel, title, body, data, status, priority, created_at, read_at
FROM notif.notifications
WHERE recipient_id = :userId
  AND tenant_id = :tenantId
  AND (:statusFilter IS NULL OR status = ANY(:statusFilter))
  AND (:channelFilter IS NULL OR channel = :channelFilter)
  AND (created_at, id) < (:cursorCreatedAt, :cursorId)
ORDER BY created_at DESC, id DESC
LIMIT :limit;
```

#### GetUnreadCount

**Actor:** authenticated user (own notifications)
**Implementation:**

- First checks Redis key `notif:unread:{tenant_id}:{user_id}` (TTL 60s)
- On cache miss, executes:
  ```sql
  SELECT count(*) FROM notif.notifications
  WHERE recipient_id = :userId
    AND tenant_id = :tenantId
    AND channel = 'in_app'
    AND status IN ('sent', 'delivered');
  ```
- Caches the result in Redis with 60s TTL
- The count is decremented on `MarkAsRead` and incremented on new in-app notification creation

#### ListRules

**Actor:** tenant_admin+
**Parameters:** cursor, limit (max 100, default 25), filter[event_type], filter[is_active]
**Implementation:**

- RLS filters by `tenant_id`
- Cursor-based pagination on `(created_at DESC, id DESC)`

#### GetRule

**Actor:** tenant_admin+
**Parameters:** rule_id
**Implementation:**

- Load rule, verify tenant matches via RLS
- Return full rule DTO including template preview

#### GetPreferences

**Actor:** authenticated user (own preferences)
**Implementation:**

- Load all preference rows for `user_id = current_user_id`
- If a channel has no preference row, return default values (enabled=true, no quiet hours, no muted rules)
- Always returns entries for all 5 user-facing channels (in_app, push, sms, email, voice)

#### GetDeliveryStatus

**Actor:** tenant_admin+ (for any notification in tenant) or notification owner
**Parameters:** notification_id
**Implementation:**

- Load notification with all status timestamps (sent_at, delivered_at, read_at, failed_reason)
- If the notification has fallback children (in `data.fallback_from`), include their statuses
- Return delivery timeline

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max, Length,
  MaxLength, IsUUID, IsArray, ArrayMinSize, IsBoolean,
  IsObject, Matches, ValidateNested, IsMilitaryTime,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Command DTOs ──────────────────────────────────────────

export class CreateRuleDto {
  @IsString()
  @Length(3, 200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @Length(3, 100)
  eventType: string;

  @IsObject()
  condition: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(NotificationChannel, { each: true })
  channels: NotificationChannel[];

  @IsString()
  @Length(1, 100)
  templateCode: string;

  @IsInt()
  @Min(1)
  @Max(4)
  priority: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @IsOptional()
  @IsString()
  @Length(1, 100)
  templateCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePreferencesDto {
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsMilitaryTime()
  quietHoursStart?: string;

  @IsOptional()
  @IsMilitaryTime()
  quietHoursEnd?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_\/]+$/)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  mutedRules?: string[];
}

export class RegisterDeviceDto {
  @IsString()
  @Length(1, 4096)
  token: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceName?: string;
}

// ── Response DTOs ─────────────────────────────────────────

export class NotificationDto {
  id: string;
  tenantId: string;
  ruleId: string | null;
  channel: NotificationChannel;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: NotificationStatus;
  priority: number;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export class NotificationDetailDto extends NotificationDto {
  eventId: string;
  recipientId: string;
  failedReason: string | null;
  retryCount: number;
  fallbackNotifications: NotificationDto[];
}

export class UnreadCountDto {
  count: number;
}

export class RuleDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  eventType: string;
  condition: Record<string, unknown>;
  channels: NotificationChannel[];
  templateCode: string;
  priority: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class PreferenceDto {
  channel: NotificationChannel;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  mutedRules: string[];
}

export class DeviceDto {
  id: string;
  platform: DevicePlatform;
  deviceName: string | null;
  isActive: boolean;
  lastUsedAt: string;
  createdAt: string;
}
```

### Endpoints

```
GET    /api/v1/notifications
  Query: cursor, limit (1-100, default 25),
         filter[status] (unread | read | all, default all),
         filter[channel] (in_app | push | sms | email)
  Response 200: { data: NotificationDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/notifications/count
  Response 200: { data: UnreadCountDto }

POST   /api/v1/notifications/:id/read
  Response 200: { data: NotificationDto }
  Errors: 404 NOTIFICATION_NOT_FOUND, 422 (not in-app or already read)

POST   /api/v1/notifications/read-all
  Response 200: { data: { updatedCount: number } }

GET    /api/v1/notifications/preferences
  Response 200: { data: PreferenceDto[] }

PATCH  /api/v1/notifications/preferences
  Body: UpdatePreferencesDto
  Response 200: { data: PreferenceDto }
  Errors: 400 (validation), 422 (invalid timezone)

POST   /api/v1/notifications/devices
  Body: RegisterDeviceDto
  Response 201: { data: DeviceDto }
  Errors: 400 (validation), 422 NOTIFICATION_DEVICE_INVALID

DELETE /api/v1/notifications/devices/:id
  Response 204
  Errors: 404 NOTIFICATION_NOT_FOUND

GET    /api/v1/notification-rules
  Query: cursor, limit (1-100, default 25),
         filter[event_type], filter[is_active] (true | false)
  Response 200: { data: RuleDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/notification-rules/:id
  Response 200: { data: RuleDto }
  Errors: 404 NOTIFICATION_RULE_NOT_FOUND

POST   /api/v1/notification-rules
  Body: CreateRuleDto
  Headers: Idempotency-Key (optional, UUID)
  Response 201: { data: RuleDto }
  Errors: 400 (validation), 422 NOTIFICATION_TEMPLATE_ERROR, 422 NOTIFICATION_SIREN_REQUIRES_CRITICAL

PATCH  /api/v1/notification-rules/:id
  Body: UpdateRuleDto
  Response 200: { data: RuleDto }
  Errors: 404 NOTIFICATION_RULE_NOT_FOUND, 400 (validation), 422 NOTIFICATION_TEMPLATE_ERROR

DELETE /api/v1/notification-rules/:id
  Response 204
  Errors: 404 NOTIFICATION_RULE_NOT_FOUND

POST   /api/v1/notification-rules/:id/test
  Response 200: { data: { notificationIds: string[], channels: string[] } }
  Errors: 404 NOTIFICATION_RULE_NOT_FOUND, 422 NOTIFICATION_TEMPLATE_ERROR
```

### Error Codes

| Code                                  | HTTP | Description                                                              |
| ------------------------------------- | ---- | ------------------------------------------------------------------------ |
| NOTIFICATION_NOT_FOUND                | 404  | Notification does not exist or does not belong to the requesting user    |
| NOTIFICATION_RULE_NOT_FOUND           | 404  | Notification rule does not exist or does not belong to the user's tenant |
| NOTIFICATION_CHANNEL_UNAVAILABLE      | 503  | The requested delivery channel is temporarily unavailable                |
| NOTIFICATION_RATE_LIMITED             | 429  | User has exceeded the rate limit for the specified channel               |
| NOTIFICATION_TEMPLATE_ERROR           | 422  | Template code not found or template rendering failed                     |
| NOTIFICATION_DEVICE_INVALID           | 422  | Device token is malformed or the platform is not supported               |
| NOTIFICATION_SIREN_REQUIRES_CRITICAL  | 422  | Siren channel can only be used with priority 1 (CRITICAL) rules         |
| NOTIFICATION_ALREADY_READ             | 422  | Notification has already been marked as read                             |
| NOTIFICATION_NOT_IN_APP               | 422  | Only in-app notifications can be marked as read                          |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes a standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "notification.sent.v1"
  source: string;      // "notification-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### notification.sent.v1

Emitted when a notification is successfully handed off to the channel adapter.

```json
{
  "id": "019526b0-1000-7000-8000-000000000001",
  "type": "notification.sent.v1",
  "source": "notification-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:30:05.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000099",
  "data": {
    "notificationId": "019526b0-1000-7000-8000-000000000010",
    "ruleId": "019526b0-0500-7000-8000-000000000001",
    "eventId": "019526a0-7c00-7000-8000-000000000001",
    "recipientId": "019526a0-1000-7000-8000-000000000050",
    "channel": "push",
    "priority": 1,
    "sentAt": "2026-04-12T08:30:05.000Z"
  }
}
```

#### notification.delivered.v1

Emitted when a delivery receipt is received from the channel provider (push acknowledgement, SMS delivery report).

```json
{
  "id": "019526b0-1000-7000-8000-000000000002",
  "type": "notification.delivered.v1",
  "source": "notification-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:30:07.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000099",
  "data": {
    "notificationId": "019526b0-1000-7000-8000-000000000010",
    "recipientId": "019526a0-1000-7000-8000-000000000050",
    "channel": "push",
    "deliveredAt": "2026-04-12T08:30:07.000Z"
  }
}
```

#### notification.failed.v1

Emitted when notification delivery fails after all retries.

```json
{
  "id": "019526b0-1000-7000-8000-000000000003",
  "type": "notification.failed.v1",
  "source": "notification-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T08:30:15.000Z",
  "correlationId": "019526a0-7c00-7000-8000-000000000099",
  "data": {
    "notificationId": "019526b0-1000-7000-8000-000000000010",
    "ruleId": "019526b0-0500-7000-8000-000000000001",
    "eventId": "019526a0-7c00-7000-8000-000000000001",
    "recipientId": "019526a0-1000-7000-8000-000000000050",
    "channel": "sms",
    "priority": 1,
    "failedReason": "SMS gateway timeout after 3 retries",
    "retryCount": 3,
    "willFallback": true,
    "fallbackChannel": "voice"
  }
}
```

### Consumed Events

#### incident.created.v1

**Source:** Incident module
**Handler:** Notify all shift_leads and tenant_admins in the tenant.

```typescript
@EventHandler('incident.created.v1')
async handleIncidentCreated(event: EventEnvelope<IncidentCreatedData>): Promise<void> {
  const { incidentId, code, title, category, severity, createdBy } = event.data;

  // Resolve recipients: shift_lead+ and tenant_admin users for this tenant
  const recipients = await this.iamService.getUsersByMinRole(event.tenantId, 'shift_lead');

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients,
  });
}
```

#### incident.severity_changed.v1

**Source:** Incident module
**Handler:** If severity == 4 (CRITICAL): broadcast to ALL tenant users + trigger siren. Otherwise: notify incident participants.

```typescript
@EventHandler('incident.severity_changed.v1')
async handleSeverityChanged(event: EventEnvelope<SeverityChangedData>): Promise<void> {
  const { incidentId, before, after, reason } = event.data;

  if (after === 4) {
    // CRITICAL broadcast: ALL users in tenant
    const allUsers = await this.iamService.getAllActiveUsers(event.tenantId);
    await this.processEvent.execute({
      eventId: event.id,
      tenantId: event.tenantId,
      eventType: event.type,
      data: event.data,
      recipients: allUsers,
      forcePriority: NotificationPriority.CRITICAL,
    });
  } else {
    // Non-critical: notify participants only
    const participants = await this.incidentService.getParticipantUserIds(incidentId);
    await this.processEvent.execute({
      eventId: event.id,
      tenantId: event.tenantId,
      eventType: event.type,
      data: event.data,
      recipients: participants,
    });
  }
}
```

#### incident.status_changed.v1

**Source:** Incident module
**Handler:** Notify all incident participants.

```typescript
@EventHandler('incident.status_changed.v1')
async handleStatusChanged(event: EventEnvelope<StatusChangedData>): Promise<void> {
  const { incidentId } = event.data;
  const participants = await this.incidentService.getParticipantUserIds(incidentId);

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: participants,
  });
}
```

#### incident.commander_assigned.v1

**Source:** Incident module
**Handler:** Notify the newly assigned commander.

```typescript
@EventHandler('incident.commander_assigned.v1')
async handleCommanderAssigned(event: EventEnvelope<CommanderAssignedData>): Promise<void> {
  const { newCommanderId } = event.data;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: [newCommanderId],
  });
}
```

#### task.assigned.v1

**Source:** Task module
**Handler:** Notify the assignee.

```typescript
@EventHandler('task.assigned.v1')
async handleTaskAssigned(event: EventEnvelope<TaskAssignedData>): Promise<void> {
  const { assigneeId } = event.data;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: [assigneeId],
  });
}
```

#### task.sla_breached.v1

**Source:** Task module
**Handler:** Notify the assignee and the incident commander (if task is incident-linked).

```typescript
@EventHandler('task.sla_breached.v1')
async handleSlaBreached(event: EventEnvelope<SlaBreachedData>): Promise<void> {
  const { assigneeId, incidentId } = event.data;
  const recipients = [assigneeId];

  if (incidentId) {
    const incident = await this.incidentService.getIncident(incidentId);
    if (incident.commanderId) {
      recipients.push(incident.commanderId);
    }
  }

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: [...new Set(recipients)], // deduplicate
  });
}
```

#### task.completed.v1

**Source:** Task module
**Handler:** Notify the assigner (person who created or last assigned the task).

```typescript
@EventHandler('task.completed.v1')
async handleTaskCompleted(event: EventEnvelope<TaskCompletedData>): Promise<void> {
  const { assignerId } = event.data;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: [assignerId],
  });
}
```

#### document.review_requested.v1

**Source:** Document module
**Handler:** Notify all listed approvers.

```typescript
@EventHandler('document.review_requested.v1')
async handleReviewRequested(event: EventEnvelope<ReviewRequestedData>): Promise<void> {
  const { approverIds } = event.data;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: approverIds,
  });
}
```

#### document.approved.v1

**Source:** Document module
**Handler:** Notify the document owner.

```typescript
@EventHandler('document.approved.v1')
async handleDocumentApproved(event: EventEnvelope<DocumentApprovedData>): Promise<void> {
  const { ownerId } = event.data;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: [ownerId],
  });
}
```

#### chat.message.posted.v1

**Source:** Chat module
**Handler:** Parse @mentions from message body, notify mentioned users.

```typescript
@EventHandler('chat.message.posted.v1')
async handleChatMessage(event: EventEnvelope<ChatMessageData>): Promise<void> {
  const { body, authorId } = event.data;

  // Parse @mentions: matches @[display_name](user_id) pattern
  const mentionPattern = /@\[([^\]]+)\]\(([0-9a-f-]+)\)/g;
  const mentionedUserIds: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(body)) !== null) {
    mentionedUserIds.push(match[2]);
  }

  // Remove duplicates and exclude the author
  const recipients = [...new Set(mentionedUserIds)].filter(id => id !== authorId);

  if (recipients.length === 0) return;

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients,
  });
}
```

#### iam.breakglass.activated.v1

**Source:** IAM module
**Handler:** Alert all platform_admin users.

```typescript
@EventHandler('iam.breakglass.activated.v1')
async handleBreakglass(event: EventEnvelope<BreakglassData>): Promise<void> {
  const admins = await this.iamService.getUsersByRole(event.tenantId, 'platform_admin');

  await this.processEvent.execute({
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.type,
    data: event.data,
    recipients: admins,
    forcePriority: NotificationPriority.CRITICAL,
  });
}
```

#### iam.user.deactivated.v1

**Source:** IAM module
**Handler:** Deactivate all push tokens for the deactivated user. No notification is sent.

```typescript
@EventHandler('iam.user.deactivated.v1')
async handleUserDeactivated(event: EventEnvelope<UserDeactivatedData>): Promise<void> {
  const { userId } = event.data;

  await this.deviceRepository.deactivateAllForUser(userId);
  // No notification dispatched — this is a housekeeping action
}
```

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS notif;

-- =============================================================================
-- rules (notification rule definitions)
-- =============================================================================
CREATE TABLE notif.rules (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    name            text            NOT NULL CHECK (char_length(name) BETWEEN 3 AND 200),
    description     text            CHECK (char_length(description) <= 2000),
    event_type      text            NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 100),
    condition       jsonb           NOT NULL DEFAULT '{}',
    channels        text[]          NOT NULL CHECK (
                        array_length(channels, 1) >= 1
                        AND channels <@ ARRAY['in_app','push','sms','email','voice','siren']::text[]
                    ),
    template_code   text            NOT NULL CHECK (char_length(template_code) BETWEEN 1 AND 100),
    priority        smallint        NOT NULL CHECK (priority BETWEEN 1 AND 4),
    is_active       boolean         NOT NULL DEFAULT true,
    created_by      uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- Tenant + event_type lookup (primary query path for ProcessEvent)
CREATE INDEX idx_rules_tenant_event_type ON notif.rules (tenant_id, event_type)
    WHERE is_active = true;

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_rules_tenant_id ON notif.rules (tenant_id);

-- Template code lookup (for validation)
CREATE INDEX idx_rules_template_code ON notif.rules (template_code);

-- Constraint: siren channel requires CRITICAL priority
ALTER TABLE notif.rules ADD CONSTRAINT chk_siren_critical
    CHECK (NOT ('siren' = ANY(channels)) OR priority = 1);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION notif.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rules_updated_at
    BEFORE UPDATE ON notif.rules
    FOR EACH ROW
    EXECUTE FUNCTION notif.update_updated_at();

-- =============================================================================
-- notifications (partitioned by created_at, monthly)
-- =============================================================================
CREATE TABLE notif.notifications (
    id              uuid            NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    rule_id         uuid            REFERENCES notif.rules(id),
    event_id        uuid            NOT NULL,
    recipient_id    uuid            NOT NULL,
    channel         text            NOT NULL CHECK (channel IN (
                        'in_app','push','sms','email','voice','siren'
                    )),
    title           text            NOT NULL CHECK (char_length(title) <= 500),
    body            text            NOT NULL CHECK (char_length(body) <= 5000),
    data            jsonb           NOT NULL DEFAULT '{}',
    status          text            NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','queued','sent','delivered','failed','read'
                    )),
    priority        smallint        NOT NULL CHECK (priority BETWEEN 1 AND 4),
    sent_at         timestamptz,
    delivered_at    timestamptz,
    read_at         timestamptz,
    failed_reason   text            CHECK (char_length(failed_reason) <= 2000),
    retry_count     smallint        NOT NULL DEFAULT 0,
    digest_group    text,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for current and next 3 months
-- In production, pg_partman manages partition creation automatically.
CREATE TABLE notif.notifications_2026_04 PARTITION OF notif.notifications
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE notif.notifications_2026_05 PARTITION OF notif.notifications
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notif.notifications_2026_06 PARTITION OF notif.notifications
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE notif.notifications_2026_07 PARTITION OF notif.notifications
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Idempotency constraint: same event + rule + recipient + channel cannot produce duplicate notification
CREATE UNIQUE INDEX idx_notifications_idempotency
    ON notif.notifications (event_id, rule_id, recipient_id, channel, created_at);

-- User + status query (the primary query for "my unread notifications")
CREATE INDEX idx_notifications_user_status
    ON notif.notifications (recipient_id, status, created_at DESC)
    WHERE status IN ('sent', 'delivered');

-- User + channel + status (for channel-specific queries)
CREATE INDEX idx_notifications_user_channel
    ON notif.notifications (recipient_id, channel, status, created_at DESC);

-- Cursor-based pagination composite
CREATE INDEX idx_notifications_cursor
    ON notif.notifications (recipient_id, created_at DESC, id DESC);

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_notifications_tenant_id
    ON notif.notifications (tenant_id);

-- Digest group lookup (for digest aggregation worker)
CREATE INDEX idx_notifications_digest
    ON notif.notifications (digest_group, created_at)
    WHERE digest_group IS NOT NULL;

-- Queued notifications (for quiet hours release and rate limit release workers)
CREATE INDEX idx_notifications_queued
    ON notif.notifications (status, channel, created_at)
    WHERE status = 'queued';

-- Trigger: auto-update timestamps (applied per partition by pg_partman)
CREATE TRIGGER trg_notifications_updated_at
    BEFORE UPDATE ON notif.notifications
    FOR EACH ROW
    EXECUTE FUNCTION notif.update_updated_at();

-- =============================================================================
-- preferences (per user per channel)
-- =============================================================================
CREATE TABLE notif.preferences (
    user_id             uuid        NOT NULL REFERENCES iam.users(id),
    channel             text        NOT NULL CHECK (channel IN (
                            'in_app','push','sms','email','voice'
                        )),
    enabled             boolean     NOT NULL DEFAULT true,
    quiet_hours_start   time,
    quiet_hours_end     time,
    timezone            text        NOT NULL DEFAULT 'UTC',
    muted_rules         uuid[]      NOT NULL DEFAULT '{}',
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel)
);

-- Constraint: quiet hours must be both set or both null
ALTER TABLE notif.preferences ADD CONSTRAINT chk_quiet_hours_pair
    CHECK (
        (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
        OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
    );

CREATE INDEX idx_preferences_user_id ON notif.preferences (user_id);

-- =============================================================================
-- templates (per code per tenant per channel)
-- =============================================================================
CREATE TABLE notif.templates (
    code                text            NOT NULL CHECK (char_length(code) BETWEEN 1 AND 100),
    tenant_id           uuid            NOT NULL REFERENCES iam.tenants(id),
    channel             text            NOT NULL CHECK (channel IN (
                            'in_app','push','sms','email','voice','siren'
                        )),
    subject_template    text            CHECK (char_length(subject_template) <= 500),
    body_template       text            NOT NULL CHECK (char_length(body_template) <= 10000),
    variables           jsonb           NOT NULL DEFAULT '{}',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    PRIMARY KEY (code, tenant_id, channel)
);

-- Lookup by code (for template resolution with tenant fallback)
CREATE INDEX idx_templates_code ON notif.templates (code);

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON notif.templates
    FOR EACH ROW
    EXECUTE FUNCTION notif.update_updated_at();

-- =============================================================================
-- devices (FCM/APNs push tokens per user per device)
-- =============================================================================
CREATE TABLE notif.devices (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid            NOT NULL REFERENCES iam.users(id),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    token           text            NOT NULL,
    platform        text            NOT NULL CHECK (platform IN ('android','ios','web')),
    device_name     text            CHECK (char_length(device_name) <= 200),
    is_active       boolean         NOT NULL DEFAULT true,
    last_used_at    timestamptz     NOT NULL DEFAULT now(),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- Unique token across the system
CREATE UNIQUE INDEX idx_devices_token ON notif.devices (token);

-- User lookup (find all devices for a user)
CREATE INDEX idx_devices_user_id ON notif.devices (user_id)
    WHERE is_active = true;

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_devices_tenant_id ON notif.devices (tenant_id);

-- Stale token cleanup (tokens unused for 90 days)
CREATE INDEX idx_devices_last_used ON notif.devices (last_used_at)
    WHERE is_active = true;

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON notif.devices
    FOR EACH ROW
    EXECUTE FUNCTION notif.update_updated_at();

-- =============================================================================
-- outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE notif.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'notification',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_outbox_unpublished ON notif.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE notif.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.devices ENABLE ROW LEVEL SECURITY;

-- Policy: rules visible to same tenant
CREATE POLICY tenant_isolation ON notif.rules
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: notifications visible to same tenant AND recipient is current user
CREATE POLICY tenant_isolation ON notif.notifications
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

CREATE POLICY recipient_isolation ON notif.notifications
    FOR SELECT
    USING (
        recipient_id = current_setting('app.current_user_id')::uuid
        OR current_setting('app.current_user_role_level')::smallint >= 4  -- tenant_admin+
    );

-- Policy: preferences visible to own user only
CREATE POLICY user_isolation ON notif.preferences
    USING (
        user_id = current_setting('app.current_user_id')::uuid
    );

-- Policy: templates visible to same tenant (or default tenant)
CREATE POLICY tenant_isolation ON notif.templates
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
        OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    );

-- Policy: devices visible to same tenant AND own user
CREATE POLICY tenant_isolation ON notif.devices
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

CREATE POLICY user_isolation ON notif.devices
    FOR SELECT
    USING (
        user_id = current_setting('app.current_user_id')::uuid
    );
```

### Data Retention

```sql
-- Notifications older than 90 days are archived to cold storage and deleted from the hot table.
-- Executed by a weekly pg_cron job.
-- The archival process:
-- 1. COPY matching rows to notif.notifications_archive (unpartitioned, compressed)
-- 2. DELETE from notif.notifications WHERE created_at < now() - interval '90 days'
-- 3. pg_partman detaches and drops old partitions automatically

-- Archive table (for compliance and audit)
CREATE TABLE notif.notifications_archive (
    LIKE notif.notifications INCLUDING ALL
) WITH (autovacuum_enabled = false);

-- Compress archive
ALTER TABLE notif.notifications_archive SET (
    toast_tuple_target = 128
);
```

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The notification module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Operation                          | Permission String                   | Minimum Role      | Additional Conditions                              |
| ---------------------------------- | ----------------------------------- | ----------------- | -------------------------------------------------- |
| List own notifications             | `notification.read`                 | field_responder   | `recipient_id = current_user_id` enforced by RLS   |
| Get unread count                   | `notification.read`                 | field_responder   | Own notifications only                              |
| Mark notification as read          | `notification.read`                 | field_responder   | `recipient_id = current_user_id`, in-app only      |
| Mark all as read                   | `notification.read`                 | field_responder   | Own notifications only                              |
| Get own preferences                | `notification.preferences`          | field_responder   | `user_id = current_user_id`                        |
| Update own preferences             | `notification.preferences`          | field_responder   | `user_id = current_user_id`                        |
| Register device                    | `notification.devices`              | field_responder   | `user_id = current_user_id`                        |
| Unregister device                  | `notification.devices`              | field_responder   | `user_id = current_user_id`                        |
| List rules                         | `notification.rules.read`           | tenant_admin      | Tenant-scoped via RLS                              |
| Get rule                           | `notification.rules.read`           | tenant_admin      | Tenant-scoped via RLS                              |
| Create rule                        | `notification.rules.manage`         | tenant_admin      |                                                     |
| Update rule                        | `notification.rules.manage`         | tenant_admin      |                                                     |
| Delete rule                        | `notification.rules.manage`         | tenant_admin      |                                                     |
| Send test notification             | `notification.rules.manage`         | tenant_admin      | Test delivered to requesting user only              |
| View any notification (admin)      | `notification.admin.read`           | tenant_admin      | Can see all notifications in tenant                 |
| View delivery status               | `notification.admin.read`           | tenant_admin      | Or own notification                                 |

### CRITICAL Override

CRITICAL notifications (priority 1) bypass all permission and preference checks:

1. They are delivered regardless of user's `notification.read` permission status.
2. They are delivered regardless of `enabled = false` on any channel.
3. They are delivered regardless of `muted_rules` containing the triggering rule.
4. They are delivered regardless of quiet hours.
5. The only way to prevent a CRITICAL notification is to deactivate the rule itself (requires `notification.rules.manage`).

### Role Hierarchy (Reference)

```
field_responder < duty_operator < incident_commander (IC) < shift_lead < tenant_admin < super_admin < platform_admin
```

---

## 9. Edge Cases

### External Channel Failures

**SMS gateway down:**
- The SMS channel adapter returns an error after the configured timeout (30 seconds).
- The notification is re-queued via NATS with exponential backoff: 5s, 15s, 45s, 135s, 405s (max 5 retries).
- After 5 failed attempts, the notification is moved to the dead letter queue (DLQ) subject `notif.dlq.sms`.
- The notification status is set to `failed` with `failed_reason = 'SMS gateway unreachable after 5 retries'`.
- For CRITICAL notifications, the channel fallback chain activates: SMS failure triggers voice TTS attempt.
- A `notification.failed.v1` event is published for monitoring and alerting.

**FCM returns HTTP 410 (token expired):**
- The push adapter receives the 410 response and immediately marks the device token as `is_active = false` in `notif.devices`.
- The current notification for this device is marked as `failed` with `failed_reason = 'FCM token expired (410)'`.
- If the user has other active devices, the push is retried on those devices.
- If the user has no remaining active devices:
  - For CRITICAL notifications: fallback to SMS channel.
  - For non-critical: the push delivery is skipped; the in-app notification (if included in channels) is still delivered.
- The user's next in-app notification includes `data.re_register_prompt = true` to prompt device re-registration.

**Email SMTP connection failure:**
- Retry with exponential backoff via NATS (same as SMS: 5 retries).
- After max retries, mark as failed and publish `notification.failed.v1`.
- Email does not participate in the fallback chain -- it is a separate delivery path.

**Voice TTS gateway timeout:**
- Voice call has a 60-second timeout (includes ring time and TTS playback).
- On timeout, one immediate retry is attempted.
- After the retry fails, the notification is marked as failed.
- Since voice is the last channel in the fallback chain, no further fallback is attempted.
- A `notification.failed.v1` event is published; if the notification was CRITICAL, an in-app alert is sent to `platform_admin` users.

### Idempotency Edge Cases

**Duplicate event from NATS replay:**
- NATS JetStream may redeliver events after consumer restart or acknowledgment timeout.
- First line of defense: Redis `SET NX` on `notif:dedup:{event_id}:{rule_id}` (TTL 7 days).
- Second line of defense: DB unique index on `(event_id, rule_id, recipient_id, channel, created_at)` with `ON CONFLICT DO NOTHING`.
- The duplicate event is silently discarded with no side effects.
- The NATS message is ACKed to prevent further redelivery.

**Redis unavailable during dedup check:**
- If Redis is down, the dedup check falls through to the database unique constraint.
- The `INSERT ... ON CONFLICT DO NOTHING` ensures no duplicate notification is created.
- A warning is logged: "Redis dedup unavailable, falling back to DB constraint."
- Processing continues without interruption.

### Notification Storm

**100+ notifications in 1 minute for the same user:**
- The rate limiter detects that the per-channel hourly limit is being approached.
- Once the threshold is reached (e.g., 60 push notifications/hour), subsequent notifications are held in `queued` status.
- Additionally, a storm detection heuristic activates when > 20 notifications are created for the same user within a 5-minute window (for non-CRITICAL priorities):
  1. All pending LOW and NORMAL priority notifications in the window are consolidated into a single digest.
  2. The digest body reads: "You have {count} new notifications in the last 5 minutes. Tap to view."
  3. Individual notification rows are updated with `status = 'sent'` and `digest_group = {digest_id}`.
- CRITICAL notifications are never aggregated into digests and are exempt from storm detection.

### Quiet Hours Edge Cases

**Notification created during quiet hours:**
- Non-critical notifications (priority 2-4) for push, SMS, email, and voice channels are set to `status = 'queued'` with no dispatch.
- In-app notifications are delivered immediately regardless of quiet hours (they appear in the bell icon but do not trigger push/sound).
- A background cron job runs every minute:
  ```sql
  SELECT DISTINCT n.recipient_id, n.channel
  FROM notif.notifications n
  JOIN notif.preferences p ON p.user_id = n.recipient_id AND p.channel = n.channel
  WHERE n.status = 'queued'
    AND n.priority > 1
    AND (
      -- Quiet hours have ended: current time in user's timezone is outside quiet window
      (p.quiet_hours_start > p.quiet_hours_end
       AND (now() AT TIME ZONE p.timezone)::time BETWEEN p.quiet_hours_end AND p.quiet_hours_start)
      OR
      (p.quiet_hours_start <= p.quiet_hours_end
       AND (now() AT TIME ZONE p.timezone)::time NOT BETWEEN p.quiet_hours_start AND p.quiet_hours_end)
    );
  ```
- Matching notifications are released and dispatched in batch.

**User changes quiet hours while notifications are queued:**
- The next cron run re-evaluates all queued notifications against the updated quiet hours.
- If the new quiet hours no longer apply (e.g., user removed quiet hours), queued notifications are released immediately on the next cron cycle (within 1 minute).

### Template Edge Cases

**Template variable missing from event context:**
- The Handlebars renderer is configured with a custom helper that catches missing variables.
- Missing variables render as `[missing: field_name]` in the output.
- A structured warning is logged:
  ```json
  {
    "level": "warn",
    "message": "Template variable missing during render",
    "templateCode": "incident_severity_critical",
    "channel": "push",
    "missingVariable": "commander.name",
    "eventId": "019526a0-7c00-7000-8000-000000000001",
    "notificationId": "019526b0-1000-7000-8000-000000000010"
  }
  ```
- The notification is still dispatched -- missing variables do not block delivery.

**Template rendering timeout (infinite loop in Handlebars expression):**
- Template rendering is sandboxed with a 500ms timeout.
- If the timeout fires, the notification is marked as `failed` with `failed_reason = 'Template rendering timeout (500ms exceeded)'`.
- A `notification.failed.v1` event is published.
- The rule is NOT automatically deactivated (the issue may be in the event data, not the template).

**Tenant-specific template not found:**
- The template resolver first queries `(code, tenant_id, channel)`.
- If not found, it queries `(code, '00000000-0000-0000-0000-000000000000', channel)` for the system default.
- If the default is also not found, the notification is marked as `failed` with `failed_reason = 'Template not found: {code} for channel {channel}'` and error code `NOTIFICATION_TEMPLATE_ERROR`.

### Siren-Specific Edge Cases

**Siren API timeout:**
- First attempt has a 10-second timeout.
- On timeout, one retry is attempted after a 5-second wait.
- If the retry also fails:
  1. The siren notification is marked as `failed` with `failed_reason = 'Siren API timeout after 2 attempts'`.
  2. An in-app notification with priority CRITICAL is created for all `platform_admin` users:
     - Title: "SIREN ACTIVATION FAILED"
     - Body: "Automatic siren activation failed for incident {incident_code}. Manual activation is required immediately."
  3. The failure does NOT block other channel notifications for the same event -- push, SMS, email, voice continue independently.

**Siren API returns success but physical siren does not activate:**
- This is outside the notification module's control. The module trusts the API response.
- The siren system is expected to have its own health monitoring.
- The notification module records the API response in `data.siren_response` for audit purposes.

### User Has No Push Token

- During push dispatch, the adapter queries `notif.devices` for active tokens for the user.
- If no active tokens exist:
  - The push notification is marked as `failed` with `failed_reason = 'No active push tokens for user'`.
  - For CRITICAL notifications: the fallback chain skips push and proceeds directly to SMS.
  - For non-critical: the push channel is silently skipped; other channels in the rule still execute.
- No error is surfaced to the triggering event -- the notification module handles this gracefully.

### Concurrency Issues

**Two events arrive simultaneously for the same rule:**
- Each event is processed by a separate NATS consumer instance.
- The Redis dedup key and DB unique constraint ensure no duplicate notifications are created.
- Both events are processed independently; there is no cross-event coordination required.

**User marks notification as read while a delivery receipt arrives:**
- Both operations are commutative: if `read_at` is already set, the delivery receipt update does not overwrite it.
- The status precedence is: `read > delivered > sent > queued > pending`.
- The update query uses: `UPDATE ... SET status = 'delivered', delivered_at = :ts WHERE status NOT IN ('read', 'failed')`.

**Partition creation race during month boundary:**
- `pg_partman` manages partition creation using advisory locks.
- If two connections attempt to create the same partition simultaneously, the advisory lock serializes them and the second attempt is a no-op.
- The application never creates partitions directly -- it relies on `pg_partman`'s background worker.

### Data Consistency

**Event processed but DB write fails:**
- The NATS message is not ACKed until all DB writes succeed.
- If the DB write fails, NATS redelivers the event after the acknowledgment timeout.
- On redelivery, the idempotency checks (Redis + DB constraint) prevent duplicates for any notifications that were partially created before the failure.
- This ensures at-least-once delivery semantics with effective deduplication.

**Redis cache and DB out of sync for unread count:**
- The unread count Redis key has a 60-second TTL.
- On cache miss, the count is recalculated from the database.
- On new notification creation, the cache is incremented atomically via `INCR`.
- On mark-as-read, the cache is decremented atomically via `DECR`.
- If the cache value drifts negative (due to a race), it is reset to 0 and the next cache miss recalculates from DB.

---

## 10. Channel Adapters

Each delivery channel is implemented as an independent adapter behind a common `ChannelAdapter` interface. Adapters receive dispatch messages from NATS subjects and handle the channel-specific delivery logic.

### Adapter Interface

```typescript
export interface ChannelAdapter {
  readonly channel: NotificationChannel;

  /**
   * Dispatch a notification through this channel.
   * Returns a ChannelResult indicating success or failure.
   */
  dispatch(notification: Notification, context: DispatchContext): Promise<ChannelResult>;
}

export interface DispatchContext {
  tenantId: string;
  recipientId: string;
  recipientEmail?: string;
  recipientPhone?: string;
  devices?: Device[];
  tenantConfig: TenantChannelConfig;
}

export interface ChannelResult {
  success: boolean;
  providerMessageId?: string;
  failedReason?: string;
  metadata?: Record<string, unknown>;
}

export interface TenantChannelConfig {
  sms: { gatewayUrl: string; apiKey: string; senderId: string };
  email: { smtpHost: string; smtpPort: number; fromAddress: string; fromName: string };
  voice: { gatewayUrl: string; apiKey: string; callerId: string };
  push: { fcmProjectId: string; fcmCredentials: string; apnsTeamId: string; apnsKeyId: string };
  siren: { apiUrl: string; apiKey: string };
}
```

### NATS Subjects

| Subject                 | Consumer Group              | Purpose                              |
| ----------------------- | --------------------------- | ------------------------------------ |
| `notif.dispatch.in_app` | `notif-inapp-workers`       | In-app notification creation         |
| `notif.dispatch.push`   | `notif-push-workers`        | FCM/APNs push delivery               |
| `notif.dispatch.sms`    | `notif-sms-workers`         | SMS gateway delivery                 |
| `notif.dispatch.email`  | `notif-email-workers`       | SMTP email delivery                  |
| `notif.dispatch.voice`  | `notif-voice-workers`       | Voice TTS call delivery              |
| `notif.dispatch.siren`  | `notif-siren-workers`       | Siren API activation                 |
| `notif.digest`          | `notif-digest-workers`      | Digest aggregation (15-min cron)     |
| `notif.quiet-release`   | `notif-quiet-workers`       | Quiet hours release (1-min cron)     |
| `notif.dlq.*`           | `notif-dlq-monitor`         | Dead letter queue monitoring         |

### In-App Adapter

The in-app adapter is the simplest channel. It writes the notification to the database and optionally pushes a WebSocket event to the user's active sessions for real-time bell icon updates.

```typescript
async dispatch(notification: Notification, context: DispatchContext): Promise<ChannelResult> {
  // 1. Notification row already created by ProcessEvent worker
  // 2. Update status to 'sent', set sent_at
  await this.notificationRepository.updateStatus(notification.id, 'sent', { sentAt: new Date() });

  // 3. Push real-time update via WebSocket (Redis pub/sub to user's channel)
  await this.wsGateway.sendToUser(context.recipientId, 'notification:new', {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    priority: notification.priority,
    createdAt: notification.createdAt,
  });

  // 4. Increment unread count cache
  await this.redis.incr(`notif:unread:${context.tenantId}:${context.recipientId}`);

  return { success: true };
}
```

### Push Adapter (FCM/APNs)

```typescript
async dispatch(notification: Notification, context: DispatchContext): Promise<ChannelResult> {
  const devices = context.devices?.filter(d => d.isActive) ?? [];
  if (devices.length === 0) {
    return { success: false, failedReason: 'No active push tokens for user' };
  }

  const results: { device: Device; success: boolean; error?: string }[] = [];

  for (const device of devices) {
    try {
      if (device.platform === 'android' || device.platform === 'web') {
        const response = await this.fcm.send({
          token: device.token,
          notification: { title: notification.title, body: notification.body },
          data: notification.data as Record<string, string>,
          android: { priority: notification.priority <= 2 ? 'high' : 'normal' },
        });
        results.push({ device, success: true });
        await this.deviceRepository.updateLastUsed(device.id);
      } else if (device.platform === 'ios') {
        await this.apns.send({
          token: device.token,
          alert: { title: notification.title, body: notification.body },
          payload: notification.data,
          priority: notification.priority <= 2 ? 10 : 5,
          pushType: 'alert',
        });
        results.push({ device, success: true });
        await this.deviceRepository.updateLastUsed(device.id);
      }
    } catch (error) {
      if (error.status === 410 || error.code === 'messaging/registration-token-not-registered') {
        // Token expired: deactivate device
        await this.deviceRepository.deactivate(device.id);
        results.push({ device, success: false, error: 'Token expired (410)' });
      } else {
        results.push({ device, success: false, error: error.message });
      }
    }
  }

  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    failedReason: anySuccess ? undefined : results.map(r => r.error).join('; '),
    metadata: { deviceResults: results.map(r => ({ deviceId: r.device.id, success: r.success, error: r.error })) },
  };
}
```

---

## 11. Background Workers

### Digest Aggregation Worker

**Schedule:** Every 15 minutes (cron: `*/15 * * * *`)
**NATS Subject:** `notif.digest`

```typescript
async processPendingDigests(): Promise<void> {
  // 1. Find all users with queued LOW priority notifications
  const digestGroups = await this.notificationRepository.findDigestCandidates({
    status: 'queued',
    priority: NotificationPriority.LOW,
    createdBefore: new Date(Date.now() - 15 * 60 * 1000), // older than 15 min
  });

  // 2. Group by (recipient_id, channel)
  for (const [key, notifications] of digestGroups) {
    const { recipientId, channel } = parseKey(key);

    if (notifications.length === 1) {
      // Single notification: dispatch normally, no digest wrapper
      await this.dispatchSingle(notifications[0]);
      continue;
    }

    // 3. Create digest notification
    const digestNotification = await this.notificationRepository.create({
      tenantId: notifications[0].tenantId,
      ruleId: null,
      eventId: notifications[0].eventId, // use first event as anchor
      recipientId,
      channel,
      title: `You have ${notifications.length} new notifications`,
      body: notifications.map(n => `- ${n.title}`).join('\n'),
      data: {
        type: 'digest',
        notificationIds: notifications.map(n => n.id),
        count: notifications.length,
      },
      status: 'pending',
      priority: NotificationPriority.LOW,
      digestGroup: null,
    });

    // 4. Mark individual notifications as sent with digest_group reference
    await this.notificationRepository.batchUpdateStatus(
      notifications.map(n => n.id),
      'sent',
      { digestGroup: digestNotification.id },
    );

    // 5. Dispatch the digest notification
    await this.nats.publish(`notif.dispatch.${channel}`, digestNotification);
  }
}
```

### Quiet Hours Release Worker

**Schedule:** Every 1 minute (cron: `* * * * *`)
**NATS Subject:** `notif.quiet-release`

Releases queued non-critical notifications for users whose quiet hours have ended. See the SQL query in Section 9 (Quiet Hours Edge Cases).

### Stale Device Token Cleanup Worker

**Schedule:** Weekly (cron: `0 3 * * 0` -- Sunday 03:00 UTC)

```sql
UPDATE notif.devices
SET is_active = false, updated_at = now()
WHERE is_active = true
  AND last_used_at < now() - interval '90 days';
```

### Dead Letter Queue Monitor

**NATS Subject:** `notif.dlq.*`

Consumes messages from the DLQ, logs them with full context, and creates an alert notification for `platform_admin` users if the DLQ depth exceeds 100 messages within a 1-hour window.

### Outbox Poller

**Schedule:** Every 1 second (pg_cron or application-level polling)

```sql
WITH pending AS (
    SELECT id, type, payload, tenant_id
    FROM notif.outbox
    WHERE published_at IS NULL
    ORDER BY created_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE notif.outbox o
SET published_at = now()
FROM pending p
WHERE o.id = p.id
RETURNING o.*;
```

Each returned row is published to NATS JetStream on the subject derived from `type` (e.g., `notification.sent.v1` -> NATS subject `coescd.notification.sent.v1`).

---

## 12. Relations with Other Modules

### Incident Module

**Relationship:** Primary event source. The notification module consumes 5 incident event types.

**Integration pattern:**
- Notification consumes events via NATS JetStream consumer group `notif-incident-consumers`.
- For recipient resolution, the notification module queries the Incident module's API (or shared database view) to resolve incident participants.
- Cached in Redis: participant lists per incident (TTL 5 minutes, invalidated on `incident.participant_added.v1` and `incident.participant_removed.v1`).

### Task Module

**Relationship:** Event source for assignment, SLA breach, and completion notifications.

**Integration pattern:**
- Notification consumes 3 task event types via NATS.
- For `task.sla_breached.v1`, the notification module queries the Incident module to resolve the incident commander.

### Document Module

**Relationship:** Event source for review request and approval notifications.

**Integration pattern:**
- Notification consumes 2 document event types via NATS.
- Recipient lists (approvers, owner) are included in the event payload -- no cross-module query needed.

### Chat Module

**Relationship:** Event source for @mention notifications.

**Integration pattern:**
- Notification consumes `chat.message.posted.v1` via NATS.
- @mentions are parsed from the message body using regex. User IDs are embedded in the mention syntax.

### IAM Module

**Relationship:** User identity, role resolution, and break-glass alerting.

**Integration pattern:**
- Notification queries IAM to resolve user lists by role (e.g., "all shift_leads in tenant X").
- Notification queries IAM for user contact details (email, phone) needed for SMS/email/voice channels.
- Notification consumes `iam.breakglass.activated.v1` for platform admin alerting.
- Notification consumes `iam.user.deactivated.v1` for push token cleanup.
- IAM user data is cached in Redis with 5-minute TTL.

### Analytics Module

**Relationship:** The analytics module consumes `notification.sent.v1`, `notification.delivered.v1`, and `notification.failed.v1` events to build delivery dashboards and channel reliability metrics.

### GIS Module

**Relationship:** No direct integration. GIS events (e.g., `gis.features_recalculated.v1`) are not consumed by the notification module. Any GIS-related notifications flow through the Incident module's events.
