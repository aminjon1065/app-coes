# Event System Architecture

> CoESCD National Disaster Management Platform -- Cross-Module Eventing via NATS JetStream

---

## 1. Overview

Event-driven architecture is the primary mechanism for cross-module communication in CoESCD. The platform is a NestJS modular monolith composed of 10 bounded contexts (IAM, Incident, Task, Document, Chat, Call, GIS, File, Analytics, Audit) that coordinate exclusively through asynchronous domain events. No module may import another module's service layer; all cross-cutting behavior flows through events.

The system provides:

- **At-least-once delivery** to consumers via NATS JetStream durable consumers with explicit acknowledgement.
- **Exactly-once delivery to NATS** via the transactional outbox pattern -- business writes and event writes share the same PostgreSQL transaction.
- **Idempotent consumers** that deduplicate on `event.id` using a two-phase Redis SET with 24-hour TTL.
- **Eventual consistency** documented per use case with explicit SLA targets for propagation lag.

Events serve five purposes:

| # | Purpose | Example |
|---|---------|---------|
| 1 | **Cross-domain side effects** | `incident.created.v1` triggers chat room creation, notification dispatch, and search indexing. |
| 2 | **Audit trail** | Every domain event is consumed by the Audit module and written to an append-only, hash-chained audit log. |
| 3 | **Analytics** | Every domain event is consumed by the Analytics ETL pipeline for operational dashboards and post-incident reports. |
| 4 | **Realtime fan-out** | Domain events flow through NATS to the Realtime Gateway, which fans them out over WebSocket to connected clients. |
| 5 | **Search indexing** | Domain events are consumed by OpenSearch indexing workers to keep full-text search current. |

**Hard rule:** A REST handler may publish events (by writing to the outbox) but must **NEVER** `await` a downstream subscriber. The HTTP response completes independently of event processing. Violating this rule reintroduces temporal coupling and defeats the entire architecture.

---

## 2. Naming Convention

### Pattern

```
<domain>.<entity>.<action>.v<n>
```

Events are dot-separated, lowercase, past tense. The entity segment is optional when the domain _is_ the entity (e.g., `incident.created.v1` rather than `incident.incident.created.v1`).

### Rules

| Rule | Detail |
|------|--------|
| Action tense | MUST be past tense: `created`, `assigned`, `closed`. Never `create`, `assign`, `close`. |
| Version | Starts at `v1`. Monotonically increasing integers. |
| Domain | Matches the bounded context name exactly: `iam`, `incident`, `task`, `document`, `chat`, `call`, `gis`, `file`, `analytics`, `audit`, `notification`. |
| No abbreviations | `severity_changed`, not `sev_chg`. `commander_assigned`, not `cmd_asgn`. |
| Snake case within segments | Multi-word segments use underscores: `sla_breached`, `status_changed`. |
| Versioning lifecycle | A version is never deleted. Breaking changes ship as `.v2` while `.v1` continues publishing for a minimum of 2 release cycles. |

### Examples

```
incident.created.v1
incident.severity_changed.v1
incident.commander_assigned.v1
task.sla_breached.v1
iam.user.deactivated.v1
iam.breakglass.activated.v1
chat.message.posted.v1
gis.feature.bulk_imported.v1
file.scanned.v1
```

---

## 3. Event Envelope

Every event published within CoESCD uses a standard envelope. This envelope is defined once in `packages/contracts/src/events/domain-event.interface.ts` and shared across all modules.

### TypeScript Interface

```typescript
/**
 * Standard envelope for every domain event in CoESCD.
 * Generic parameter T carries the event-specific payload.
 */
export interface DomainEvent<T = unknown> {
  /** Globally unique identifier. UUIDv7 (time-ordered). Used as idempotency key. */
  id: string;

  /** Event type following the naming convention: <domain>.<entity>.<action>.v<n> */
  type: string;

  /** When the domain event occurred. ISO 8601 with millisecond precision. */
  occurredAt: string;

  /** Tenant that owns this event. UUID. */
  tenantId: string;

  /** The actor who initiated the action. */
  actor: {
    /** Discriminator for the actor type. */
    type: 'user' | 'system' | 'api_key' | 'break_glass';
    /** UUID of the actor. Null for system-initiated events. */
    id: string | null;
    /** Source IP address. Null for system-initiated events. */
    ip: string | null;
  };

  /** The primary entity affected by this event. */
  subject: {
    /** Entity type, matching the bounded context entity name. */
    type: string;
    /** UUID of the affected entity. */
    id: string;
  };

  /**
   * Traces a user-initiated chain across modules. Originates at the REST
   * request (set from X-Correlation-Id header or generated at the API gateway).
   * Every downstream event in the chain carries the same correlationId.
   */
  correlationId: string;

  /**
   * The ID of the event that directly caused this event. For the first event
   * in a chain (created by a REST handler), causationId equals the event's own id.
   * For subsequent events (e.g., incident.created -> chat.channel.created),
   * causationId is the id of the triggering event.
   */
  causationId: string;

  /** Event-specific payload. Typed per event. */
  data: T;

  /**
   * URL to the JSON Schema that validates the data field.
   * Resolves to a file in packages/contracts/events/.
   * Example: "sentinel://contracts/events/incident/severity_changed/v1.json"
   */
  schema: string;
}
```

### JSON Example

```json
{
  "id": "019512a4-7c2e-7f3a-b8d1-4e3f6a2b9c01",
  "type": "incident.severity_changed.v1",
  "occurredAt": "2026-03-15T14:32:07.841Z",
  "tenantId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "actor": {
    "type": "user",
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "ip": "10.0.12.45"
  },
  "subject": {
    "type": "incident",
    "id": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a"
  },
  "correlationId": "019512a4-5100-7000-8000-abcdef012345",
  "causationId": "019512a4-7c2e-7f3a-b8d1-4e3f6a2b9c01",
  "data": {
    "previousSeverity": "moderate",
    "newSeverity": "critical",
    "reason": "Aftershock reported, expanding impact zone"
  },
  "schema": "sentinel://contracts/events/incident/severity_changed/v1.json"
}
```

### Field Reference

| Field | Purpose |
|-------|---------|
| `id` | Globally unique UUIDv7. Time-ordered so events can be sorted chronologically by ID. Used as the NATS message ID for server-side deduplication, and as the Redis idempotency key on the consumer side. |
| `type` | Fully qualified event name. Consumers filter on this. Matches the NATS subject (prefixed with `coescd.`). |
| `occurredAt` | The wall-clock time when the domain event happened (not when it was published to NATS). Millisecond precision is required because SLA breach calculations depend on it. |
| `tenantId` | Multi-tenancy discriminator. Every query, every consumer filter, every authorization check scopes on this. |
| `actor` | Who or what triggered the action. `break_glass` is a special escalation mode where a user bypasses normal RBAC. `system` covers cron jobs, SLA timers, and automated workflows. |
| `subject` | The primary entity affected. A consumer can filter on `subject.type` to build entity-specific projections. |
| `correlationId` | Born at the API gateway from the `X-Correlation-Id` header (or generated if absent). Propagated unchanged through every downstream event in the chain. Enables distributed tracing: given a correlationId, you can reconstruct the full event chain across modules. |
| `causationId` | The direct parent. For the root event (originated from a REST call), `causationId === id`. For a reaction event (e.g., `chat.channel.created` caused by `incident.created`), `causationId` is the `id` of `incident.created`. This forms a tree structure for causal analysis. |
| `data` | The event-specific payload. Typed per event via generics. Validated against the JSON Schema referenced in `schema`. |
| `schema` | A stable URI pointing to the JSON Schema in `packages/contracts/events/`. Used at validation time. The `sentinel://` protocol prefix is resolved by the schema registry loader to a local filesystem path in development and to an internal HTTP endpoint in production. |

---

## 4. NATS JetStream Configuration

### 4.1 Streams

One stream per bounded context, plus infrastructure streams for audit and dead letters.

| Stream Name | Subjects | Retention | MaxAge | MaxBytes | Storage | Replicas |
|---|---|---|---|---|---|---|
| `STREAM_IAM` | `coescd.iam.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_INCIDENT` | `coescd.incident.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_TASK` | `coescd.task.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_DOCUMENT` | `coescd.document.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_CHAT` | `coescd.chat.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_CALL` | `coescd.call.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_GIS` | `coescd.gis.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_FILE` | `coescd.file.>` | limits | 7d | 100GB | file | 3 |
| `STREAM_ANALYTICS` | `coescd.analytics.>` | limits | 7d | 50GB | file | 3 |
| `STREAM_NOTIFICATION` | `coescd.notification.>` | limits | 7d | 50GB | file | 3 |
| `STREAM_AUDIT` | `coescd.audit.>` | limits | 30d | 500GB | file | 3 |
| `STREAM_DLQ` | `coescd.dlq.>` | limits | 30d | 100GB | file | 3 |

Replicas are set to 3 for all streams in production (NATS cluster of 3+ nodes). In development, replicas default to 1.

### 4.2 Consumer Configuration

Every consumer across all modules follows this standard configuration:

| Parameter | Value | Rationale |
|---|---|---|
| **Durable Name** | `<consuming_module>-<event_type>` | Survives restarts. Example: `chat-incident.created.v1` |
| **Ack Policy** | Explicit | No auto-ack. Consumer must explicitly ACK or NACK. |
| **MaxDeliver** | 8 | After 8 delivery attempts, message routes to DLQ. |
| **Backoff** | `[1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s]` | Exponential backoff across the 8 attempts. Total wait before DLQ: ~255s. |
| **AckWait** | 30s | If no ACK/NACK within 30s, NATS considers it a failed delivery. |
| **MaxAckPending** | 1000 | Flow control. At most 1000 unacknowledged messages per consumer. |
| **FilterSubject** | Specific per consumer | Each consumer subscribes only to the subjects it needs. |
| **DeliverPolicy** | All | On first bind, deliver all available messages from the stream. |
| **ReplayPolicy** | Instant | Catch up as fast as possible (no rate limiting on replay). |

After `MaxDeliver` is exhausted, the outbox relay's DLQ advisor publishes the failed message to `STREAM_DLQ` with preserved headers:

| Header | Value |
|---|---|
| `CoESCD-Original-Stream` | e.g., `STREAM_INCIDENT` |
| `CoESCD-Original-Subject` | e.g., `coescd.incident.severity_changed.v1` |
| `CoESCD-Last-Error` | Stringified error from last attempt |
| `CoESCD-Attempt-Count` | `8` |
| `CoESCD-First-Attempt-At` | ISO 8601 timestamp |
| `CoESCD-Last-Attempt-At` | ISO 8601 timestamp |

### 4.3 Subject Naming

NATS subjects follow the pattern:

```
coescd.<domain>.<entity>.<action>.<version>
```

Examples:

```
coescd.incident.created.v1
coescd.incident.severity_changed.v1
coescd.iam.user.deactivated.v1
coescd.task.sla_breached.v1
coescd.chat.message.posted.v1
coescd.gis.feature.bulk_imported.v1
```

The `coescd.` prefix scopes all platform events and prevents collisions with any infrastructure subjects.

### 4.4 NestJS Stream and Consumer Setup

```typescript
// libs/eventing/src/nats-jetstream.setup.ts

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { connect, JetStreamManager, StreamConfig, RetentionPolicy, StorageType } from 'nats';
import { ConfigService } from '@nestjs/config';

interface StreamDefinition {
  name: string;
  subjects: string[];
  maxAge: number;       // nanoseconds
  maxBytes: number;
  retention: RetentionPolicy;
  storage: StorageType;
  numReplicas: number;
}

const NANOS_PER_MS = 1_000_000;
const NANOS_PER_SEC = 1_000_000_000;
const NANOS_PER_DAY = 86_400 * NANOS_PER_SEC;

const STREAM_DEFINITIONS: StreamDefinition[] = [
  { name: 'STREAM_IAM',          subjects: ['coescd.iam.>'],          maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_INCIDENT',     subjects: ['coescd.incident.>'],     maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_TASK',         subjects: ['coescd.task.>'],         maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_DOCUMENT',     subjects: ['coescd.document.>'],     maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_CHAT',         subjects: ['coescd.chat.>'],         maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_CALL',         subjects: ['coescd.call.>'],         maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_GIS',          subjects: ['coescd.gis.>'],          maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_FILE',         subjects: ['coescd.file.>'],         maxAge: 7  * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_ANALYTICS',    subjects: ['coescd.analytics.>'],    maxAge: 7  * NANOS_PER_DAY, maxBytes: 50  * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_NOTIFICATION', subjects: ['coescd.notification.>'], maxAge: 7  * NANOS_PER_DAY, maxBytes: 50  * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_AUDIT',        subjects: ['coescd.audit.>'],        maxAge: 30 * NANOS_PER_DAY, maxBytes: 500 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
  { name: 'STREAM_DLQ',          subjects: ['coescd.dlq.>'],          maxAge: 30 * NANOS_PER_DAY, maxBytes: 100 * 1e9, retention: RetentionPolicy.Limits, storage: StorageType.File, numReplicas: 3 },
];

@Injectable()
export class NatsJetStreamSetup implements OnModuleInit {
  private readonly logger = new Logger(NatsJetStreamSetup.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const nc = await connect({
      servers: this.config.getOrThrow<string>('NATS_URL'),
    });
    const jsm: JetStreamManager = await nc.jetstreamManager();

    const replicas = this.config.get<number>('NATS_REPLICAS', 3);

    for (const def of STREAM_DEFINITIONS) {
      const streamConfig: Partial<StreamConfig> = {
        name: def.name,
        subjects: def.subjects,
        retention: def.retention,
        max_age: def.maxAge,
        max_bytes: def.maxBytes,
        storage: def.storage,
        num_replicas: replicas,
        duplicate_window: 120 * NANOS_PER_SEC, // 2min dedupe window for outbox relay
      };

      try {
        await jsm.streams.info(def.name);
        await jsm.streams.update(def.name, streamConfig);
        this.logger.log(`Stream ${def.name} updated`);
      } catch {
        await jsm.streams.add(streamConfig as StreamConfig);
        this.logger.log(`Stream ${def.name} created`);
      }
    }

    await nc.close();
  }
}
```

```typescript
// libs/eventing/src/consumer.factory.ts

import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  ConsumerConfig,
  JetStreamManager,
  NatsConnection,
  nanos,
} from 'nats';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000];

export function buildConsumerConfig(
  durableName: string,
  filterSubject: string,
): Partial<ConsumerConfig> {
  return {
    durable_name: durableName,
    filter_subject: filterSubject,
    ack_policy: AckPolicy.Explicit,
    ack_wait: nanos(30_000),            // 30s
    max_deliver: 8,
    max_ack_pending: 1000,
    deliver_policy: DeliverPolicy.All,
    replay_policy: ReplayPolicy.Instant,
    backoff: BACKOFF_MS.map((ms) => nanos(ms)),
  };
}

export async function ensureConsumer(
  jsm: JetStreamManager,
  streamName: string,
  durableName: string,
  filterSubject: string,
): Promise<void> {
  const config = buildConsumerConfig(durableName, filterSubject);
  try {
    await jsm.consumers.info(streamName, durableName);
    await jsm.consumers.update(streamName, durableName, config);
  } catch {
    await jsm.consumers.add(streamName, config as ConsumerConfig);
  }
}
```

---

## 5. Outbox Pattern

### 5.1 Why

Producers **never** publish directly to NATS. Instead, they write an event record to an `outbox` table within the **same database transaction** as the business write. A background relay process polls the outbox and publishes to NATS.

This guarantees:

1. **Atomicity** -- the business write and the event write succeed or fail together. If the transaction rolls back, no event exists.
2. **Durability during outages** -- if NATS is unreachable, events accumulate in the outbox and flush automatically when connectivity resumes.
3. **Exactly-once publishing to NATS** -- the outbox relay uses the event `id` as the NATS message ID. NATS JetStream's duplicate detection window (120 seconds) rejects duplicate publishes if the relay retries.

### 5.2 Outbox Table DDL

Each bounded context owns its own PostgreSQL schema and its own outbox table within that schema.

```sql
-- Template: replace <schema> with the module's schema name.

CREATE TABLE <schema>.outbox (
  id            uuid        PRIMARY KEY,
  type          text        NOT NULL,
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);

-- Partial index: only unpublished rows, ordered by creation time.
CREATE INDEX idx_outbox_unpublished
  ON <schema>.outbox (created_at)
  WHERE published_at IS NULL;
```

Concrete tables for all 10 modules:

```sql
-- IAM
CREATE TABLE iam.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_iam_outbox_unpublished ON iam.outbox (created_at) WHERE published_at IS NULL;

-- Incident
CREATE TABLE incident.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_incident_outbox_unpublished ON incident.outbox (created_at) WHERE published_at IS NULL;

-- Task
CREATE TABLE task.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_task_outbox_unpublished ON task.outbox (created_at) WHERE published_at IS NULL;

-- Document
CREATE TABLE document.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_document_outbox_unpublished ON document.outbox (created_at) WHERE published_at IS NULL;

-- Chat
CREATE TABLE chat.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_chat_outbox_unpublished ON chat.outbox (created_at) WHERE published_at IS NULL;

-- Call
CREATE TABLE call.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_call_outbox_unpublished ON call.outbox (created_at) WHERE published_at IS NULL;

-- GIS
CREATE TABLE gis.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_gis_outbox_unpublished ON gis.outbox (created_at) WHERE published_at IS NULL;

-- File
CREATE TABLE file.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_file_outbox_unpublished ON file.outbox (created_at) WHERE published_at IS NULL;

-- Analytics
CREATE TABLE analytics.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_analytics_outbox_unpublished ON analytics.outbox (created_at) WHERE published_at IS NULL;

-- Audit
CREATE TABLE audit.outbox (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX idx_audit_outbox_unpublished ON audit.outbox (created_at) WHERE published_at IS NULL;
```

### 5.3 Relay Process

The outbox relay is a per-module background service that polls the outbox table at a configurable interval (default 100ms), reads a batch of unpublished events, publishes each to NATS with the event ID as the NATS message ID, and marks them as published.

```typescript
// libs/eventing/src/outbox-relay.service.ts

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { JetStreamClient, PubAck, headers, StringCodec } from 'nats';
import { DomainEvent } from '@sentinel/contracts';

interface OutboxRow {
  id: string;
  type: string;
  payload: DomainEvent;
  created_at: Date;
}

@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly sc = StringCodec();
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly js: JetStreamClient,
    private readonly schemaName: string,
    private readonly pollIntervalMs: number = 100,
    private readonly batchSize: number = 100,
  ) {}

  start(): void {
    this.intervalHandle = setInterval(() => {
      this.flushBatch().catch((err) => {
        this.logger.error(`Outbox relay flush failed: ${err.message}`, err.stack);
      });
    }, this.pollIntervalMs);
    this.logger.log(
      `Outbox relay started for ${this.schemaName}.outbox ` +
      `(poll=${this.pollIntervalMs}ms, batch=${this.batchSize})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async flushBatch(): Promise<void> {
    const rows: OutboxRow[] = await this.connection.query(
      `SELECT id, type, payload, created_at
       FROM ${this.schemaName}.outbox
       WHERE published_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1`,
      [this.batchSize],
    );

    if (rows.length === 0) return;

    const publishedIds: string[] = [];

    for (const row of rows) {
      try {
        // Convert event type to NATS subject: incident.created.v1 -> coescd.incident.created.v1
        const subject = `coescd.${row.type}`;
        const payload = JSON.stringify(row.payload);

        // Use event ID as NATS message ID for server-side deduplication.
        const pubHeaders = headers();
        pubHeaders.set('Nats-Msg-Id', row.id);

        const ack: PubAck = await this.js.publish(subject, this.sc.encode(payload), {
          headers: pubHeaders,
          msgID: row.id,
          timeout: 5000,
        });

        if (ack.duplicate) {
          this.logger.debug(`Event ${row.id} was a duplicate (already in NATS), marking published`);
        }

        publishedIds.push(row.id);
      } catch (err) {
        // Skip this event; it will be retried on the next poll cycle.
        this.logger.warn(
          `Failed to publish event ${row.id} (${row.type}): ${err.message}. Will retry.`,
        );
      }
    }

    if (publishedIds.length > 0) {
      await this.connection.query(
        `UPDATE ${this.schemaName}.outbox
         SET published_at = now()
         WHERE id = ANY($1)`,
        [publishedIds],
      );
      this.logger.debug(`Published and marked ${publishedIds.length} events from ${this.schemaName}.outbox`);
    }
  }
}
```

**Cleanup via pg_cron:**

```sql
-- Runs every hour. Purges published outbox rows older than 24 hours.
SELECT cron.schedule(
  'purge-iam-outbox',
  '0 * * * *',
  $$DELETE FROM iam.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$
);

-- Repeat for each schema:
SELECT cron.schedule('purge-incident-outbox', '0 * * * *',
  $$DELETE FROM incident.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-task-outbox', '0 * * * *',
  $$DELETE FROM task.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-document-outbox', '0 * * * *',
  $$DELETE FROM document.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-chat-outbox', '0 * * * *',
  $$DELETE FROM chat.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-call-outbox', '0 * * * *',
  $$DELETE FROM call.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-gis-outbox', '0 * * * *',
  $$DELETE FROM gis.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-file-outbox', '0 * * * *',
  $$DELETE FROM file.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-analytics-outbox', '0 * * * *',
  $$DELETE FROM analytics.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
SELECT cron.schedule('purge-audit-outbox', '0 * * * *',
  $$DELETE FROM audit.outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '24 hours'$$);
```

### 5.4 How a Producer Writes to the Outbox

```typescript
// Example: incident module creating an incident and writing to outbox in one transaction.

import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { DomainEvent } from '@sentinel/contracts';
import { IncidentCreatedV1Data } from '@sentinel/contracts/events/incident';

@Injectable()
export class IncidentService {
  constructor(
    @InjectEntityManager() private readonly em: EntityManager,
  ) {}

  async createIncident(dto: CreateIncidentDto, actor: ActorContext): Promise<Incident> {
    return this.em.transaction(async (tx) => {
      // 1. Business write
      const incident = tx.create(Incident, {
        id: uuidv7(),
        title: dto.title,
        severity: dto.severity,
        status: 'open',
        tenantId: actor.tenantId,
        createdBy: actor.userId,
      });
      await tx.save(incident);

      // 2. Event write -- same transaction
      const event: DomainEvent<IncidentCreatedV1Data> = {
        id: uuidv7(),
        type: 'incident.created.v1',
        occurredAt: new Date().toISOString(),
        tenantId: actor.tenantId,
        actor: {
          type: 'user',
          id: actor.userId,
          ip: actor.ip,
        },
        subject: { type: 'incident', id: incident.id },
        correlationId: actor.correlationId,
        causationId: uuidv7(), // root event: causationId = own id (set after)
        data: {
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          location: dto.location,
          disasterType: dto.disasterType,
        },
        schema: 'sentinel://contracts/events/incident/created/v1.json',
      };
      // For root events, causationId = event id
      event.causationId = event.id;

      await tx.query(
        `INSERT INTO incident.outbox (id, type, payload) VALUES ($1, $2, $3)`,
        [event.id, event.type, JSON.stringify(event)],
      );

      return incident;
    });
  }
}
```

### 5.5 Guarantee Summary

| Guarantee | Mechanism |
|---|---|
| Business write + event are atomic | Same PostgreSQL transaction |
| No phantom events (event without business write) | Transaction rollback deletes outbox row |
| No lost events (business write without event) | Transaction ensures both succeed |
| Exactly-once delivery to NATS | NATS message ID deduplication (120s window) |
| At-least-once delivery to consumers | NATS redelivers on ACK timeout |
| Survives NATS outage | Events accumulate in outbox; relay retries |
| Survives application crash after DB commit but before NATS publish | Outbox row remains unpublished; relay picks it up on restart |

---

## 6. Consumer Idempotency

### 6.1 Strategy

Every consumer maintains a processed event set in Redis. Since NATS provides at-least-once delivery, consumers **will** receive duplicates (during redelivery after timeout, after restarts, during partition recovery). Idempotency is not optional.

### 6.2 Two-Phase Deduplication

A naive `SETNX` has an edge case: if the key is set but processing fails, retries will see the key and skip the event, causing silent data loss. CoESCD uses a two-phase approach:

**Phase 1 -- Acquire processing lock:**
Set a short-lived key (5 minutes) to indicate "processing in progress."

**Phase 2 -- Confirm or release:**
- On success: extend the key TTL to 24 hours (confirmed processed).
- On failure: delete the key (allow retry).

### 6.3 Redis Lua Script

```lua
-- idempotency_check.lua
-- KEYS[1] = dedup:<consumer>:<event_id>
-- ARGV[1] = "processing" | "confirmed"
-- ARGV[2] = TTL in seconds (300 for processing, 86400 for confirmed)
--
-- Returns:
--   0 = key did not exist, now set (proceed with processing)
--   1 = key exists with value "processing" (another instance is processing; skip or wait)
--   2 = key exists with value "confirmed" (already processed; skip)

local current = redis.call('GET', KEYS[1])

if current == false then
  -- Key does not exist. Set it with short TTL.
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 0
elseif current == 'confirmed' then
  return 2
elseif current == 'processing' then
  return 1
else
  return 2  -- unexpected value; treat as already processed
end
```

```lua
-- idempotency_confirm.lua
-- KEYS[1] = dedup:<consumer>:<event_id>
-- ARGV[1] = TTL in seconds (86400)
--
-- Extends TTL and sets value to "confirmed".

redis.call('SET', KEYS[1], 'confirmed', 'EX', ARGV[1])
return 1
```

```lua
-- idempotency_release.lua
-- KEYS[1] = dedup:<consumer>:<event_id>
--
-- Deletes the key to allow retry.

redis.call('DEL', KEYS[1])
return 1
```

### 6.4 NestJS Consumer Base Class

```typescript
// libs/eventing/src/idempotent-consumer.base.ts

import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { JsMsg } from 'nats';
import { DomainEvent } from '@sentinel/contracts';

const CHECK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 0
elseif current == 'confirmed' then
  return 2
elseif current == 'processing' then
  return 1
else
  return 2
end
`;

const CONFIRM_SCRIPT = `
redis.call('SET', KEYS[1], 'confirmed', 'EX', ARGV[1])
return 1
`;

const RELEASE_SCRIPT = `
redis.call('DEL', KEYS[1])
return 1
`;

export abstract class IdempotentConsumer {
  protected abstract readonly consumerName: string;
  protected abstract readonly logger: Logger;

  constructor(protected readonly redis: Redis) {}

  protected abstract handle(event: DomainEvent): Promise<void>;

  async onMessage(msg: JsMsg): Promise<void> {
    const raw = msg.data ? Buffer.from(msg.data).toString() : '';
    let event: DomainEvent;
    try {
      event = JSON.parse(raw);
    } catch (err) {
      this.logger.error(`Failed to parse event: ${err.message}`);
      msg.ack(); // Unparseable messages go to DLQ manually if needed
      return;
    }

    const dedupKey = `dedup:${this.consumerName}:${event.id}`;

    // Phase 1: check and acquire
    const result = await this.redis.eval(
      CHECK_SCRIPT,
      1,
      dedupKey,
      'processing',
      300, // 5 minutes processing lock
    ) as number;

    if (result === 2) {
      // Already confirmed processed
      this.logger.debug(`Event ${event.id} already processed, skipping`);
      msg.ack();
      return;
    }

    if (result === 1) {
      // Another instance is processing; NACK to retry later
      this.logger.debug(`Event ${event.id} being processed by another instance, will retry`);
      msg.nak();
      return;
    }

    // result === 0: we acquired the lock, proceed
    try {
      await this.handle(event);

      // Phase 2: confirm
      await this.redis.eval(CONFIRM_SCRIPT, 1, dedupKey, 86400);
      msg.ack();
    } catch (err) {
      this.logger.error(
        `Failed to process event ${event.id} (${event.type}): ${err.message}`,
        err.stack,
      );

      // Release lock so NATS redelivery can retry
      await this.redis.eval(RELEASE_SCRIPT, 1, dedupKey);
      msg.nak();
    }
  }
}
```

### 6.5 Processing Flow Summary

```
1. Receive message from NATS JetStream
2. Parse JSON into DomainEvent
3. Execute CHECK_SCRIPT on Redis key dedup:<consumer>:<event.id>
   - Returns 0 (new): proceed to step 4
   - Returns 1 (processing): NAK, let NATS redeliver later
   - Returns 2 (confirmed): ACK immediately, skip
4. Execute handler logic
5a. On success: execute CONFIRM_SCRIPT (extend TTL to 24h), ACK
5b. On failure: execute RELEASE_SCRIPT (delete key), NAK
```

---

## 7. Full Event Catalog

### 7.1 IAM Events

#### `iam.user.created.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics, Notification, Chat (auto-join default channels)

```typescript
interface IamUserCreatedV1Data {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  clearanceLevel: 'unclassified' | 'restricted' | 'confidential' | 'secret';
  department: string;
  isActive: boolean;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "email": "maria.santos@dmc.gov",
  "fullName": "Maria Santos",
  "role": "field_responder",
  "clearanceLevel": "restricted",
  "department": "Search and Rescue",
  "isActive": true
}
```

#### `iam.user.updated.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamUserUpdatedV1Data {
  userId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "changes": {
    "department": { "from": "Search and Rescue", "to": "Medical Response" },
    "fullName": { "from": "Maria Santos", "to": "Maria Santos-Rivera" }
  }
}
```

#### `iam.user.deactivated.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics, Chat (remove from channels), Notification (stop delivery), Incident (remove from active assignments)

```typescript
interface IamUserDeactivatedV1Data {
  userId: string;
  reason: 'terminated' | 'suspended' | 'leave_of_absence' | 'security_concern';
  deactivatedBy: string;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "leave_of_absence",
  "deactivatedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
}
```

#### `iam.role.assigned.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamRoleAssignedV1Data {
  userId: string;
  role: string;
  scope: 'global' | 'tenant' | 'incident';
  scopeId: string | null;
  grantedBy: string;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "role": "incident_commander",
  "scope": "incident",
  "scopeId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "grantedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
}
```

#### `iam.role.revoked.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamRoleRevokedV1Data {
  userId: string;
  role: string;
  scope: 'global' | 'tenant' | 'incident';
  scopeId: string | null;
  revokedBy: string;
  reason: string;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "role": "incident_commander",
  "scope": "incident",
  "scopeId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "revokedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "reason": "Incident command transferred"
}
```

#### `iam.clearance.changed.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics, Document (revoke access to documents above new clearance), Incident (re-evaluate participant access)

```typescript
interface IamClearanceChangedV1Data {
  userId: string;
  previousLevel: 'unclassified' | 'restricted' | 'confidential' | 'secret';
  newLevel: 'unclassified' | 'restricted' | 'confidential' | 'secret';
  changedBy: string;
  reason: string;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "previousLevel": "restricted",
  "newLevel": "confidential",
  "changedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "reason": "Promoted to senior analyst role"
}
```

#### `iam.session.opened.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamSessionOpenedV1Data {
  sessionId: string;
  userId: string;
  authMethod: 'password' | 'sso' | 'mfa' | 'certificate' | 'break_glass';
  userAgent: string;
  ip: string;
  geoLocation: { lat: number; lon: number } | null;
}
```

```json
{
  "sessionId": "019512a4-8000-7000-9000-abcdef012345",
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "authMethod": "mfa",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0",
  "ip": "10.0.12.45",
  "geoLocation": { "lat": 14.5995, "lon": 120.9842 }
}
```

#### `iam.session.closed.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamSessionClosedV1Data {
  sessionId: string;
  userId: string;
  reason: 'logout' | 'timeout' | 'forced' | 'concurrent_limit';
  durationMs: number;
}
```

```json
{
  "sessionId": "019512a4-8000-7000-9000-abcdef012345",
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "logout",
  "durationMs": 3600000
}
```

#### `iam.mfa.enrolled.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamMfaEnrolledV1Data {
  userId: string;
  method: 'totp' | 'webauthn' | 'sms';
  deviceName: string | null;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "method": "webauthn",
  "deviceName": "YubiKey 5 NFC"
}
```

#### `iam.policy.changed.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamPolicyChangedV1Data {
  policyId: string;
  policyName: string;
  changeType: 'created' | 'updated' | 'deleted';
  affectedRoles: string[];
  changedBy: string;
  diff: { field: string; from: unknown; to: unknown }[];
}
```

```json
{
  "policyId": "pol-001",
  "policyName": "incident-read-all",
  "changeType": "updated",
  "affectedRoles": ["field_responder", "analyst"],
  "changedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "diff": [
    { "field": "effect", "from": "allow", "to": "deny" }
  ]
}
```

#### `iam.breakglass.activated.v1`

- **Producer:** IAM
- **Consumers:** Audit (critical), Analytics, Notification (alert all admins immediately)

```typescript
interface IamBreakglassActivatedV1Data {
  userId: string;
  justification: string;
  expiresAt: string;
  permissionsGranted: string[];
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "justification": "National emergency: Category 5 typhoon. Need to override geo-restrictions to coordinate multi-region response.",
  "expiresAt": "2026-03-15T18:32:07.841Z",
  "permissionsGranted": ["incident:*", "task:*", "document:read:secret"]
}
```

#### `iam.breakglass.expired.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics, Notification

```typescript
interface IamBreakglassExpiredV1Data {
  userId: string;
  activatedAt: string;
  expiredAt: string;
  revokedBy: 'system' | string;
  actionsPerformed: number;
}
```

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "activatedAt": "2026-03-15T14:32:07.841Z",
  "expiredAt": "2026-03-15T18:32:07.841Z",
  "revokedBy": "system",
  "actionsPerformed": 47
}
```

#### `iam.tenant.created.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics

```typescript
interface IamTenantCreatedV1Data {
  tenantId: string;
  name: string;
  countryCode: string;
  tier: 'standard' | 'premium' | 'government';
  adminUserId: string;
}
```

```json
{
  "tenantId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "name": "National Disaster Management Authority",
  "countryCode": "PH",
  "tier": "government",
  "adminUserId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### `iam.tenant.suspended.v1`

- **Producer:** IAM
- **Consumers:** Audit, Analytics, Notification (alert all tenant admins)

```typescript
interface IamTenantSuspendedV1Data {
  tenantId: string;
  reason: 'billing' | 'security_violation' | 'admin_request' | 'compliance';
  suspendedBy: string;
  activeUserCount: number;
  activeIncidentCount: number;
}
```

```json
{
  "tenantId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "reason": "compliance",
  "suspendedBy": "super-admin-0001",
  "activeUserCount": 342,
  "activeIncidentCount": 7
}
```

---

### 7.2 Incident Events

#### `incident.created.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Chat (create incident channel), Notification (alert on-call teams), GIS (create incident map layer), Task (create default task checklist)

```typescript
interface IncidentCreatedV1Data {
  title: string;
  severity: 'low' | 'moderate' | 'high' | 'critical' | 'catastrophic';
  status: 'open';
  disasterType: string;
  location: {
    lat: number;
    lon: number;
    name: string;
    region: string;
  };
  description: string;
  estimatedAffectedPopulation: number | null;
}
```

```json
{
  "title": "Typhoon Mawar - Luzon Landfall",
  "severity": "catastrophic",
  "status": "open",
  "disasterType": "typhoon",
  "location": {
    "lat": 16.4023,
    "lon": 120.596,
    "name": "Baguio City",
    "region": "Cordillera Administrative Region"
  },
  "description": "Category 5 typhoon making landfall. Sustained winds 280km/h. Storm surge expected 6-8m.",
  "estimatedAffectedPopulation": 2500000
}
```

#### `incident.updated.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics

```typescript
interface IncidentUpdatedV1Data {
  changes: Record<string, { from: unknown; to: unknown }>;
}
```

```json
{
  "changes": {
    "description": {
      "from": "Category 5 typhoon making landfall.",
      "to": "Category 5 typhoon made landfall at 0400 local. Moving NW at 25km/h."
    },
    "estimatedAffectedPopulation": { "from": 2500000, "to": 3100000 }
  }
}
```

#### `incident.status_changed.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Notification (alert all participants), Chat (post status update to channel), Task (re-evaluate SLAs)

```typescript
interface IncidentStatusChangedV1Data {
  previousStatus: 'open' | 'responding' | 'monitoring' | 'recovery' | 'closed';
  newStatus: 'open' | 'responding' | 'monitoring' | 'recovery' | 'closed';
  reason: string;
}
```

```json
{
  "previousStatus": "open",
  "newStatus": "responding",
  "reason": "First responders deployed to affected area"
}
```

#### `incident.severity_changed.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Notification (escalation alerts), Task (re-evaluate SLAs), Chat (post alert in channel)

```typescript
interface IncidentSeverityChangedV1Data {
  previousSeverity: 'low' | 'moderate' | 'high' | 'critical' | 'catastrophic';
  newSeverity: 'low' | 'moderate' | 'high' | 'critical' | 'catastrophic';
  reason: string;
}
```

```json
{
  "previousSeverity": "high",
  "newSeverity": "critical",
  "reason": "Dam breach confirmed, downstream evacuation required"
}
```

#### `incident.commander_assigned.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Notification (alert commander + previous commander), Chat (update channel topic)

```typescript
interface IncidentCommanderAssignedV1Data {
  commanderId: string;
  commanderName: string;
  previousCommanderId: string | null;
  previousCommanderName: string | null;
}
```

```json
{
  "commanderId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "commanderName": "Col. Maria Santos",
  "previousCommanderId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "previousCommanderName": "Maj. Ricardo Cruz"
}
```

#### `incident.participant_added.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Chat (add to channel), Notification (notify participant)

```typescript
interface IncidentParticipantAddedV1Data {
  userId: string;
  userName: string;
  role: 'commander' | 'deputy' | 'liaison' | 'responder' | 'observer' | 'analyst';
  addedBy: string;
}
```

```json
{
  "userId": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "userName": "Dr. Ana Reyes",
  "role": "liaison",
  "addedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### `incident.participant_removed.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Chat (remove from channel), Notification (notify participant)

```typescript
interface IncidentParticipantRemovedV1Data {
  userId: string;
  userName: string;
  removedBy: string;
  reason: string;
}
```

```json
{
  "userId": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "userName": "Dr. Ana Reyes",
  "removedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "Reassigned to Incident INC-2026-0842"
}
```

#### `incident.sitrep.submitted.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Notification (distribute to leadership), Document (archive as record), Chat (post summary)

```typescript
interface IncidentSitrepSubmittedV1Data {
  sitrepId: string;
  sequenceNumber: number;
  submittedBy: string;
  summary: string;
  casualties: { dead: number; injured: number; missing: number };
  displacedPersons: number;
  infrastructureDamage: string;
  resourcesNeeded: string[];
  nextUpdateDue: string;
}
```

```json
{
  "sitrepId": "019512b0-1234-7000-8000-abcdef012345",
  "sequenceNumber": 3,
  "submittedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "summary": "Typhoon eye has passed. Heavy rainfall continues. 3 bridges confirmed impassable.",
  "casualties": { "dead": 12, "injured": 347, "missing": 89 },
  "displacedPersons": 45000,
  "infrastructureDamage": "3 bridges, 2 hospitals partially damaged, power grid offline in 4 districts",
  "resourcesNeeded": ["helicopter_rescue", "medical_supplies", "portable_generators"],
  "nextUpdateDue": "2026-03-15T18:00:00.000Z"
}
```

#### `incident.geofence_updated.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, GIS (update map), Notification (alert affected zones)

```typescript
interface IncidentGeofenceUpdatedV1Data {
  geofenceId: string;
  geofenceType: 'exclusion_zone' | 'evacuation_zone' | 'staging_area' | 'impact_zone';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  previousGeometry: {
    type: 'Polygon';
    coordinates: number[][][];
  } | null;
  radiusKm: number | null;
}
```

```json
{
  "geofenceId": "gf-001",
  "geofenceType": "evacuation_zone",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[120.59, 16.40], [120.61, 16.40], [120.61, 16.42], [120.59, 16.42], [120.59, 16.40]]]
  },
  "previousGeometry": null,
  "radiusKm": 5.0
}
```

#### `incident.epicenter_updated.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, GIS (update map pin)

```typescript
interface IncidentEpicenterUpdatedV1Data {
  previousLocation: { lat: number; lon: number } | null;
  newLocation: { lat: number; lon: number };
  reason: string;
}
```

```json
{
  "previousLocation": { "lat": 16.4023, "lon": 120.596 },
  "newLocation": { "lat": 16.4100, "lon": 120.601 },
  "reason": "Updated based on satellite imagery"
}
```

#### `incident.child_linked.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics

```typescript
interface IncidentChildLinkedV1Data {
  parentIncidentId: string;
  childIncidentId: string;
  childTitle: string;
  linkType: 'sub_incident' | 'related' | 'caused_by';
}
```

```json
{
  "parentIncidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "childIncidentId": "9e8f7a6b-5c4d-3e2f-1a0b-9c8d7e6f5a4b",
  "childTitle": "Landslide - Kennon Road",
  "linkType": "caused_by"
}
```

#### `incident.closed.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Chat (archive channel), Task (cancel remaining open tasks), Notification (notify all participants), Document (finalize records)

```typescript
interface IncidentClosedV1Data {
  resolution: string;
  closedBy: string;
  durationHours: number;
  finalStats: {
    casualties: { dead: number; injured: number; missing: number };
    displacedPersons: number;
    tasksCompleted: number;
    tasksAbandoned: number;
  };
}
```

```json
{
  "resolution": "Typhoon has passed. All rescue operations complete. Recovery phase transitioning to local government.",
  "closedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "durationHours": 168,
  "finalStats": {
    "casualties": { "dead": 23, "injured": 1247, "missing": 3 },
    "displacedPersons": 82000,
    "tasksCompleted": 456,
    "tasksAbandoned": 12
  }
}
```

#### `incident.reopened.v1`

- **Producer:** Incident
- **Consumers:** Audit, Analytics, Chat (unarchive channel), Notification (notify all previous participants)

```typescript
interface IncidentReopenedV1Data {
  reason: string;
  reopenedBy: string;
  previouslyClosedAt: string;
}
```

```json
{
  "reason": "Aftershock triggered secondary landslide. 2 new areas affected.",
  "reopenedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "previouslyClosedAt": "2026-03-22T09:00:00.000Z"
}
```

---

### 7.3 Task Events

#### `task.created.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (notify assignee if assigned)

```typescript
interface TaskCreatedV1Data {
  taskId: string;
  incidentId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  slaMinutes: number | null;
  parentTaskId: string | null;
  tags: string[];
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "title": "Deploy water purification units to Baguio City",
  "description": "3 portable units needed at evacuation center by 1800h local.",
  "priority": "critical",
  "assigneeId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "assigneeName": "Sgt. Paolo Mendez",
  "dueAt": "2026-03-15T10:00:00.000Z",
  "slaMinutes": 120,
  "parentTaskId": null,
  "tags": ["logistics", "water", "evacuation"]
}
```

#### `task.updated.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics

```typescript
interface TaskUpdatedV1Data {
  taskId: string;
  incidentId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "changes": {
    "description": {
      "from": "3 portable units needed at evacuation center by 1800h local.",
      "to": "5 portable units needed at evacuation center by 1800h local. 2 additional units approved."
    }
  }
}
```

#### `task.assigned.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (notify new assignee, notify previous if reassigned)

```typescript
interface TaskAssignedV1Data {
  taskId: string;
  incidentId: string;
  assigneeId: string;
  assigneeName: string;
  previousAssigneeId: string | null;
  previousAssigneeName: string | null;
  assignedBy: string;
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "assigneeId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "assigneeName": "Sgt. Paolo Mendez",
  "previousAssigneeId": null,
  "previousAssigneeName": null,
  "assignedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### `task.status_changed.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (notify assignee and commander)

```typescript
interface TaskStatusChangedV1Data {
  taskId: string;
  incidentId: string;
  previousStatus: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  newStatus: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  reason: string | null;
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "previousStatus": "pending",
  "newStatus": "in_progress",
  "reason": null
}
```

#### `task.sla_breached.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (alert commander + assignee), Incident (aggregate SLA metrics)

```typescript
interface TaskSlaBreachedV1Data {
  taskId: string;
  incidentId: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  slaMinutes: number;
  actualMinutes: number;
  breachedAt: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "title": "Deploy water purification units to Baguio City",
  "assigneeId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "assigneeName": "Sgt. Paolo Mendez",
  "slaMinutes": 120,
  "actualMinutes": 145,
  "breachedAt": "2026-03-15T12:25:00.000Z",
  "priority": "critical"
}
```

#### `task.completed.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (notify commander)

```typescript
interface TaskCompletedV1Data {
  taskId: string;
  incidentId: string;
  title: string;
  completedBy: string;
  completedByName: string;
  durationMinutes: number;
  withinSla: boolean;
  notes: string | null;
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "title": "Deploy water purification units to Baguio City",
  "completedBy": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "completedByName": "Sgt. Paolo Mendez",
  "durationMinutes": 105,
  "withinSla": true,
  "notes": "5 units deployed and operational. Capacity: 10,000L/day each."
}
```

#### `task.commented.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics, Notification (notify assignee and watchers)

```typescript
interface TaskCommentedV1Data {
  taskId: string;
  incidentId: string;
  commentId: string;
  body: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
}
```

```json
{
  "taskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "commentId": "019512d0-bbbb-7000-8000-abcdef012345",
  "body": "Road to evacuation center is blocked. Rerouting via alternate path. ETA +30min.",
  "authorId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "authorName": "Sgt. Paolo Mendez",
  "mentionedUserIds": ["f47ac10b-58cc-4372-a567-0e02b2c3d479"]
}
```

#### `task.dependency_added.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics

```typescript
interface TaskDependencyAddedV1Data {
  taskId: string;
  dependsOnTaskId: string;
  dependencyType: 'blocks' | 'required_by';
}
```

```json
{
  "taskId": "019512c0-cccc-7000-8000-abcdef012345",
  "dependsOnTaskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "dependencyType": "blocks"
}
```

#### `task.dependency_removed.v1`

- **Producer:** Task
- **Consumers:** Audit, Analytics

```typescript
interface TaskDependencyRemovedV1Data {
  taskId: string;
  dependsOnTaskId: string;
  removedBy: string;
  reason: string;
}
```

```json
{
  "taskId": "019512c0-cccc-7000-8000-abcdef012345",
  "dependsOnTaskId": "019512c0-aaaa-7000-8000-abcdef012345",
  "removedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "Task can proceed independently"
}
```

---

### 7.4 Document Events

#### `document.created.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (notify incident participants if linked to incident)

```typescript
interface DocumentCreatedV1Data {
  documentId: string;
  incidentId: string | null;
  title: string;
  documentType: 'sitrep' | 'order' | 'plan' | 'report' | 'memo' | 'sop' | 'map_annotation';
  classification: 'unclassified' | 'restricted' | 'confidential' | 'secret';
  createdBy: string;
  createdByName: string;
  fileId: string | null;
  version: number;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "title": "Evacuation Plan - Baguio City District 3",
  "documentType": "plan",
  "classification": "restricted",
  "createdBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "createdByName": "Col. Maria Santos",
  "fileId": "019512e0-bbbb-7000-8000-abcdef012345",
  "version": 1
}
```

#### `document.version_added.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (notify reviewers and watchers)

```typescript
interface DocumentVersionAddedV1Data {
  documentId: string;
  version: number;
  previousVersion: number;
  fileId: string;
  changeDescription: string;
  uploadedBy: string;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "previousVersion": 1,
  "fileId": "019512e0-cccc-7000-8000-abcdef012345",
  "changeDescription": "Updated evacuation routes based on latest road assessments",
  "uploadedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### `document.review_requested.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (notify reviewers)

```typescript
interface DocumentReviewRequestedV1Data {
  documentId: string;
  version: number;
  reviewerIds: string[];
  requestedBy: string;
  dueAt: string | null;
  urgency: 'routine' | 'urgent' | 'immediate';
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "reviewerIds": ["b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f"],
  "requestedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "dueAt": "2026-03-15T16:00:00.000Z",
  "urgency": "urgent"
}
```

#### `document.approved.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (notify author and other reviewers)

```typescript
interface DocumentApprovedV1Data {
  documentId: string;
  version: number;
  approvedBy: string;
  approvedByName: string;
  comments: string | null;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "approvedBy": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "approvedByName": "Dir. Ramon Espinoza",
  "comments": "Approved. Ensure copies distributed to all field teams."
}
```

#### `document.rejected.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (notify author)

```typescript
interface DocumentRejectedV1Data {
  documentId: string;
  version: number;
  rejectedBy: string;
  rejectedByName: string;
  reason: string;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "rejectedBy": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "rejectedByName": "Lt. Garcia",
  "reason": "Route B is no longer passable after bridge collapse at km 12. Please revise."
}
```

#### `document.signed.v1`

- **Producer:** Document
- **Consumers:** Audit (critical -- legal record), Analytics, Notification (notify all parties)

```typescript
interface DocumentSignedV1Data {
  documentId: string;
  version: number;
  signedBy: string;
  signedByName: string;
  signatureType: 'electronic' | 'digital_certificate';
  certificateId: string | null;
  signedAt: string;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "signedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "signedByName": "Col. Maria Santos",
  "signatureType": "digital_certificate",
  "certificateId": "cert-gov-ph-2026-04821",
  "signedAt": "2026-03-15T15:30:00.000Z"
}
```

#### `document.published.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics, Notification (distribute to target audience), Chat (post link in relevant channels)

```typescript
interface DocumentPublishedV1Data {
  documentId: string;
  version: number;
  publishedBy: string;
  distributionScope: 'incident' | 'tenant' | 'public';
  incidentId: string | null;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "publishedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "distributionScope": "incident",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a"
}
```

#### `document.revoked.v1`

- **Producer:** Document
- **Consumers:** Audit (critical), Analytics, Notification (alert all who received it)

```typescript
interface DocumentRevokedV1Data {
  documentId: string;
  version: number;
  revokedBy: string;
  reason: string;
  replacedByDocumentId: string | null;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "version": 2,
  "revokedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "Superseded by updated plan after new damage assessment",
  "replacedByDocumentId": "019512e0-dddd-7000-8000-abcdef012345"
}
```

#### `document.archived.v1`

- **Producer:** Document
- **Consumers:** Audit, Analytics

```typescript
interface DocumentArchivedV1Data {
  documentId: string;
  archivedBy: string;
  retentionPeriodDays: number;
}
```

```json
{
  "documentId": "019512e0-aaaa-7000-8000-abcdef012345",
  "archivedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "retentionPeriodDays": 2555
}
```

---

### 7.5 Communication Events

#### `chat.message.posted.v1`

- **Producer:** Chat
- **Consumers:** Audit, Analytics, Notification (push to offline channel members)

```typescript
interface ChatMessagePostedV1Data {
  messageId: string;
  channelId: string;
  channelName: string;
  incidentId: string | null;
  body: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
  attachmentFileIds: string[];
  replyToMessageId: string | null;
}
```

```json
{
  "messageId": "019512f0-aaaa-7000-8000-abcdef012345",
  "channelId": "ch-inc-8d7e6f5a",
  "channelName": "inc-typhoon-mawar",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "body": "Helicopter rescue team Alpha deployed to sector 7. ETA 15 minutes.",
  "authorId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "authorName": "Col. Maria Santos",
  "mentionedUserIds": ["d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a"],
  "attachmentFileIds": [],
  "replyToMessageId": null
}
```

#### `chat.message.redacted.v1`

- **Producer:** Chat
- **Consumers:** Audit (critical -- legal compliance), Analytics

```typescript
interface ChatMessageRedactedV1Data {
  messageId: string;
  channelId: string;
  redactedBy: string;
  reason: 'classified_leak' | 'personal_data' | 'legal_request' | 'admin_action';
  originalAuthorId: string;
}
```

```json
{
  "messageId": "019512f0-aaaa-7000-8000-abcdef012345",
  "channelId": "ch-inc-8d7e6f5a",
  "redactedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "reason": "classified_leak",
  "originalAuthorId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### `chat.channel.created.v1`

- **Producer:** Chat
- **Consumers:** Audit, Analytics

```typescript
interface ChatChannelCreatedV1Data {
  channelId: string;
  channelName: string;
  incidentId: string | null;
  channelType: 'incident' | 'team' | 'direct' | 'announcement';
  createdBy: string;
  initialMemberIds: string[];
}
```

```json
{
  "channelId": "ch-inc-8d7e6f5a",
  "channelName": "inc-typhoon-mawar",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "channelType": "incident",
  "createdBy": "system",
  "initialMemberIds": ["f47ac10b-58cc-4372-a567-0e02b2c3d479"]
}
```

#### `chat.channel.archived.v1`

- **Producer:** Chat
- **Consumers:** Audit, Analytics

```typescript
interface ChatChannelArchivedV1Data {
  channelId: string;
  channelName: string;
  archivedBy: string;
  reason: string;
  messageCount: number;
}
```

```json
{
  "channelId": "ch-inc-8d7e6f5a",
  "channelName": "inc-typhoon-mawar",
  "archivedBy": "system",
  "reason": "Incident closed",
  "messageCount": 2847
}
```

#### `call.started.v1`

- **Producer:** Call
- **Consumers:** Audit, Analytics, Notification (ring participants)

```typescript
interface CallStartedV1Data {
  callId: string;
  incidentId: string | null;
  callType: 'voice' | 'video' | 'conference';
  initiatedBy: string;
  initiatedByName: string;
  invitedParticipantIds: string[];
}
```

```json
{
  "callId": "019513a0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "callType": "conference",
  "initiatedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "initiatedByName": "Col. Maria Santos",
  "invitedParticipantIds": [
    "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
    "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a"
  ]
}
```

#### `call.joined.v1`

- **Producer:** Call
- **Consumers:** Audit, Analytics

```typescript
interface CallJoinedV1Data {
  callId: string;
  userId: string;
  userName: string;
  joinMethod: 'invited' | 'link' | 'dial_in';
}
```

```json
{
  "callId": "019513a0-aaaa-7000-8000-abcdef012345",
  "userId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "userName": "Dir. Ramon Espinoza",
  "joinMethod": "invited"
}
```

#### `call.left.v1`

- **Producer:** Call
- **Consumers:** Audit, Analytics

```typescript
interface CallLeftV1Data {
  callId: string;
  userId: string;
  reason: 'manual' | 'disconnected' | 'removed';
  durationSeconds: number;
}
```

```json
{
  "callId": "019513a0-aaaa-7000-8000-abcdef012345",
  "userId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "reason": "manual",
  "durationSeconds": 1847
}
```

#### `call.ended.v1`

- **Producer:** Call
- **Consumers:** Audit, Analytics

```typescript
interface CallEndedV1Data {
  callId: string;
  incidentId: string | null;
  durationSeconds: number;
  participantCount: number;
  endedBy: string | null;
  endReason: 'manual' | 'all_left' | 'timeout' | 'system';
}
```

```json
{
  "callId": "019513a0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "durationSeconds": 3600,
  "participantCount": 4,
  "endedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "endReason": "manual"
}
```

#### `call.recording_ready.v1`

- **Producer:** Call
- **Consumers:** Audit, Analytics, File (register recording asset), Document (link to incident records)

```typescript
interface CallRecordingReadyV1Data {
  callId: string;
  incidentId: string | null;
  recordingFileId: string;
  durationSeconds: number;
  sizeBytes: number;
  format: 'webm' | 'mp4' | 'ogg';
}
```

```json
{
  "callId": "019513a0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "recordingFileId": "019513b0-aaaa-7000-8000-abcdef012345",
  "durationSeconds": 3600,
  "sizeBytes": 52428800,
  "format": "webm"
}
```

---

### 7.6 GIS Events

#### `gis.layer.created.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics

```typescript
interface GisLayerCreatedV1Data {
  layerId: string;
  incidentId: string | null;
  name: string;
  layerType: 'vector' | 'raster' | 'heatmap' | 'cluster';
  sourceType: 'manual' | 'import' | 'satellite' | 'sensor' | 'system_generated';
  createdBy: string;
  featureCount: number;
  bbox: [number, number, number, number] | null;
}
```

```json
{
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "name": "Flood Extent - March 15 0800h",
  "layerType": "vector",
  "sourceType": "satellite",
  "createdBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b",
  "featureCount": 42,
  "bbox": [120.45, 16.30, 120.75, 16.55]
}
```

#### `gis.layer.published.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics, Notification (notify incident participants)

```typescript
interface GisLayerPublishedV1Data {
  layerId: string;
  incidentId: string | null;
  name: string;
  publishedBy: string;
  visibility: 'incident' | 'tenant' | 'public';
}
```

```json
{
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "name": "Flood Extent - March 15 0800h",
  "publishedBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b",
  "visibility": "incident"
}
```

#### `gis.layer.deleted.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics

```typescript
interface GisLayerDeletedV1Data {
  layerId: string;
  name: string;
  deletedBy: string;
  reason: string;
}
```

```json
{
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "name": "Flood Extent - March 15 0800h",
  "deletedBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b",
  "reason": "Superseded by updated satellite imagery"
}
```

#### `gis.feature.created.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics

```typescript
interface GisFeatureCreatedV1Data {
  featureId: string;
  layerId: string;
  incidentId: string | null;
  featureType: 'point' | 'line' | 'polygon' | 'multi_polygon';
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
  createdBy: string;
}
```

```json
{
  "featureId": "019513d0-aaaa-7000-8000-abcdef012345",
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "featureType": "polygon",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[120.50, 16.38], [120.55, 16.38], [120.55, 16.42], [120.50, 16.42], [120.50, 16.38]]]
  },
  "properties": {
    "label": "Flooded residential area",
    "floodDepthMeters": 1.5,
    "estimatedHouseholds": 340
  },
  "createdBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b"
}
```

#### `gis.feature.updated.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics

```typescript
interface GisFeatureUpdatedV1Data {
  featureId: string;
  layerId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  updatedBy: string;
}
```

```json
{
  "featureId": "019513d0-aaaa-7000-8000-abcdef012345",
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "changes": {
    "properties.floodDepthMeters": { "from": 1.5, "to": 2.1 },
    "properties.estimatedHouseholds": { "from": 340, "to": 420 }
  },
  "updatedBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b"
}
```

#### `gis.feature.deleted.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics

```typescript
interface GisFeatureDeletedV1Data {
  featureId: string;
  layerId: string;
  deletedBy: string;
}
```

```json
{
  "featureId": "019513d0-aaaa-7000-8000-abcdef012345",
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "deletedBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b"
}
```

#### `gis.feature.bulk_imported.v1`

- **Producer:** GIS
- **Consumers:** Audit, Analytics, Notification (notify layer owner)

```typescript
interface GisFeatureBulkImportedV1Data {
  layerId: string;
  incidentId: string | null;
  sourceFormat: 'geojson' | 'shapefile' | 'kml' | 'csv';
  featureCount: number;
  importedBy: string;
  bbox: [number, number, number, number];
  errors: number;
  warnings: number;
}
```

```json
{
  "layerId": "019513c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "sourceFormat": "geojson",
  "featureCount": 1247,
  "importedBy": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b",
  "bbox": [120.10, 16.00, 121.00, 17.00],
  "errors": 3,
  "warnings": 12
}
```

---

### 7.7 File Events

#### `file.uploaded.v1`

- **Producer:** File
- **Consumers:** Audit, Analytics, File (trigger virus scan)

```typescript
interface FileUploadedV1Data {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedBy: string;
  incidentId: string | null;
  checksum: string;
}
```

```json
{
  "fileId": "019513e0-aaaa-7000-8000-abcdef012345",
  "filename": "damage-assessment-sector7.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 4521984,
  "storageKey": "uploads/2026/03/15/019513e0-aaaa.pdf",
  "uploadedBy": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "checksum": "sha256:a1b2c3d4e5f6..."
}
```

#### `file.scanned.v1`

- **Producer:** File
- **Consumers:** Audit, Analytics

```typescript
interface FileScannedV1Data {
  fileId: string;
  scanResult: 'clean' | 'quarantined';
  scanEngine: string;
  scanDurationMs: number;
  threats: string[];
}
```

```json
{
  "fileId": "019513e0-aaaa-7000-8000-abcdef012345",
  "scanResult": "clean",
  "scanEngine": "ClamAV 1.3.0",
  "scanDurationMs": 234,
  "threats": []
}
```

#### `file.scan_failed.v1`

- **Producer:** File
- **Consumers:** Audit, Analytics, Notification (alert admin)

```typescript
interface FileScanFailedV1Data {
  fileId: string;
  error: string;
  willRetry: boolean;
  attemptNumber: number;
}
```

```json
{
  "fileId": "019513e0-aaaa-7000-8000-abcdef012345",
  "error": "Scan engine timeout after 30s",
  "willRetry": true,
  "attemptNumber": 1
}
```

#### `file.variant_ready.v1`

- **Producer:** File
- **Consumers:** Audit, Analytics

```typescript
interface FileVariantReadyV1Data {
  fileId: string;
  variantType: 'thumbnail' | 'preview' | 'optimized' | 'watermarked';
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  dimensions: { width: number; height: number } | null;
}
```

```json
{
  "fileId": "019513e0-bbbb-7000-8000-abcdef012345",
  "variantType": "thumbnail",
  "storageKey": "variants/019513e0-bbbb/thumb-256.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 24576,
  "dimensions": { "width": 256, "height": 192 }
}
```

#### `file.deleted.v1`

- **Producer:** File
- **Consumers:** Audit, Analytics

```typescript
interface FileDeletedV1Data {
  fileId: string;
  filename: string;
  deletedBy: string;
  reason: 'user_request' | 'retention_policy' | 'security' | 'incident_closed';
  softDelete: boolean;
}
```

```json
{
  "fileId": "019513e0-aaaa-7000-8000-abcdef012345",
  "filename": "damage-assessment-sector7.pdf",
  "deletedBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "reason": "user_request",
  "softDelete": true
}
```

---

### 7.8 Analytics Events

#### `analytics.report.generated.v1`

- **Producer:** Analytics
- **Consumers:** Audit, Notification (deliver report to requestor)

```typescript
interface AnalyticsReportGeneratedV1Data {
  reportId: string;
  reportType: 'incident_summary' | 'response_time' | 'resource_utilization' | 'sla_compliance' | 'custom';
  incidentId: string | null;
  generatedFor: string;
  fileId: string;
  format: 'pdf' | 'xlsx' | 'csv';
  dateRangeStart: string;
  dateRangeEnd: string;
  generationDurationMs: number;
}
```

```json
{
  "reportId": "019513f0-aaaa-7000-8000-abcdef012345",
  "reportType": "incident_summary",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a",
  "generatedFor": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "fileId": "019513f0-bbbb-7000-8000-abcdef012345",
  "format": "pdf",
  "dateRangeStart": "2026-03-14T00:00:00.000Z",
  "dateRangeEnd": "2026-03-22T00:00:00.000Z",
  "generationDurationMs": 4521
}
```

---

### 7.9 Notification Events

#### `notification.sent.v1`

- **Producer:** Notification
- **Consumers:** Audit, Analytics

```typescript
interface NotificationSentV1Data {
  notificationId: string;
  recipientId: string;
  channel: 'push' | 'sms' | 'email' | 'in_app' | 'websocket';
  templateId: string;
  sourceEventType: string;
  sourceEventId: string;
  incidentId: string | null;
}
```

```json
{
  "notificationId": "019514a0-aaaa-7000-8000-abcdef012345",
  "recipientId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "channel": "push",
  "templateId": "tpl-task-assigned",
  "sourceEventType": "task.assigned.v1",
  "sourceEventId": "019512c0-aaaa-7000-8000-abcdef012345",
  "incidentId": "8d7e6f5a-4b3c-2d1e-0f9a-8b7c6d5e4f3a"
}
```

#### `notification.delivered.v1`

- **Producer:** Notification
- **Consumers:** Audit, Analytics

```typescript
interface NotificationDeliveredV1Data {
  notificationId: string;
  recipientId: string;
  channel: 'push' | 'sms' | 'email' | 'in_app' | 'websocket';
  deliveredAt: string;
  latencyMs: number;
}
```

```json
{
  "notificationId": "019514a0-aaaa-7000-8000-abcdef012345",
  "recipientId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "channel": "push",
  "deliveredAt": "2026-03-15T14:32:08.102Z",
  "latencyMs": 261
}
```

#### `notification.failed.v1`

- **Producer:** Notification
- **Consumers:** Audit, Analytics

```typescript
interface NotificationFailedV1Data {
  notificationId: string;
  recipientId: string;
  channel: 'push' | 'sms' | 'email' | 'in_app' | 'websocket';
  error: string;
  willRetry: boolean;
  attemptNumber: number;
}
```

```json
{
  "notificationId": "019514a0-aaaa-7000-8000-abcdef012345",
  "recipientId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "channel": "sms",
  "error": "Carrier rejected: invalid phone number format",
  "willRetry": false,
  "attemptNumber": 1
}
```

---

### 7.10 Audit Events

#### `audit.export.ready.v1`

- **Producer:** Audit
- **Consumers:** Notification (deliver to requestor)

```typescript
interface AuditExportReadyV1Data {
  exportId: string;
  requestedBy: string;
  fileId: string;
  format: 'csv' | 'json' | 'pdf';
  recordCount: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  filters: Record<string, string>;
}
```

```json
{
  "exportId": "019514b0-aaaa-7000-8000-abcdef012345",
  "requestedBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "fileId": "019514b0-bbbb-7000-8000-abcdef012345",
  "format": "csv",
  "recordCount": 15420,
  "dateRangeStart": "2026-03-01T00:00:00.000Z",
  "dateRangeEnd": "2026-03-31T23:59:59.999Z",
  "filters": { "module": "incident", "tenantId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" }
}
```

#### `audit.chain.broken.v1`

- **Producer:** Audit
- **Consumers:** Notification (critical alert to all admins), Analytics

```typescript
interface AuditChainBrokenV1Data {
  detectedAt: string;
  brokenAfterEntryId: string;
  expectedHash: string;
  actualHash: string;
  affectedModule: string;
  affectedRecordCount: number;
}
```

```json
{
  "detectedAt": "2026-03-15T22:00:01.000Z",
  "brokenAfterEntryId": "019514c0-aaaa-7000-8000-abcdef012345",
  "expectedHash": "sha256:4a2b3c4d5e6f...",
  "actualHash": "sha256:9z8y7x6w5v4u...",
  "affectedModule": "incident",
  "affectedRecordCount": 47
}
```

---

### 7.11 Cross-Module Event Dependency Matrix

This matrix shows which modules **consume** events from which **producer** modules. Audit and Analytics consume from all producers (omitted from individual cells for clarity).

| Producer \ Consumer | IAM | Incident | Task | Document | Chat | Call | GIS | File | Notification | Realtime Gateway | OpenSearch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **IAM** | -- | `clearance.changed` `user.deactivated` | -- | `clearance.changed` | `user.created` `user.deactivated` | -- | -- | -- | `breakglass.activated` `breakglass.expired` `tenant.suspended` | `session.*` | `user.created` `user.updated` |
| **Incident** | -- | -- | `created` `status_changed` `severity_changed` `closed` | `sitrep.submitted` `closed` | `created` `status_changed` `severity_changed` `commander_assigned` `participant_added` `participant_removed` `closed` `reopened` | -- | `created` `geofence_updated` `epicenter_updated` | -- | `created` `status_changed` `severity_changed` `commander_assigned` `participant_added` `participant_removed` `sitrep.submitted` `closed` `reopened` `geofence_updated` | All incident events | All incident events |
| **Task** | -- | `sla_breached` | -- | -- | -- | -- | -- | -- | `created` `assigned` `status_changed` `sla_breached` `completed` `commented` | All task events | `created` `updated` `completed` |
| **Document** | -- | -- | -- | -- | `published` | -- | -- | -- | `created` `version_added` `review_requested` `approved` `rejected` `signed` `published` `revoked` | All document events | `created` `version_added` `published` |
| **Chat** | -- | -- | -- | -- | -- | -- | -- | -- | `message.posted` | All chat events | `message.posted` |
| **Call** | -- | -- | -- | `recording_ready` | -- | -- | -- | `recording_ready` | `started` | All call events | -- |
| **GIS** | -- | -- | -- | -- | -- | -- | -- | -- | `layer.published` `feature.bulk_imported` | All GIS events | `feature.created` `feature.updated` |
| **File** | -- | -- | -- | -- | -- | -- | -- | -- | `scan_failed` | `variant_ready` | -- |
| **Analytics** | -- | -- | -- | -- | -- | -- | -- | -- | `report.generated` | -- | -- |
| **Notification** | -- | -- | -- | -- | -- | -- | -- | -- | -- | `sent` | -- |
| **Audit** | -- | -- | -- | -- | -- | -- | -- | -- | `chain.broken` `export.ready` | -- | -- |

**Universal consumers** (subscribed to all domain events):
- **Audit module** -- writes every event to the append-only audit log
- **Analytics module** -- feeds the analytics data warehouse
- **Realtime Gateway** -- fans out to WebSocket clients (filtered by tenant and incident context)
- **OpenSearch indexer** -- updates full-text search indices (selective, per the matrix above)

---

## 8. Dead Letter Queue

### 8.1 DLQ Stream

The DLQ stream (`STREAM_DLQ`) captures messages that have exhausted all redelivery attempts (MaxDeliver = 8). Messages arrive with their original payload intact plus diagnostic headers.

**Stream configuration:**

| Property | Value |
|---|---|
| Stream Name | `STREAM_DLQ` |
| Subjects | `coescd.dlq.>` |
| Retention | limits |
| MaxAge | 30 days |
| MaxBytes | 100GB |
| Storage | file |
| Replicas | 3 |

**DLQ subject pattern:** `coescd.dlq.<original_domain>.<original_entity>.<original_action>.<version>`

Example: an `incident.severity_changed.v1` message that failed 8 times arrives at `coescd.dlq.incident.severity_changed.v1`.

**Preserved headers on DLQ messages:**

| Header | Example Value |
|---|---|
| `CoESCD-Original-Stream` | `STREAM_INCIDENT` |
| `CoESCD-Original-Subject` | `coescd.incident.severity_changed.v1` |
| `CoESCD-Consumer-Name` | `chat-incident.severity_changed.v1` |
| `CoESCD-Last-Error` | `TypeError: Cannot read property 'channelId' of undefined` |
| `CoESCD-Attempt-Count` | `8` |
| `CoESCD-First-Attempt-At` | `2026-03-15T14:32:08.000Z` |
| `CoESCD-Last-Attempt-At` | `2026-03-15T14:36:23.000Z` |

### 8.2 DLQ Admin UI

The Admin Panel exposes a "Event Health" section under **Settings > System > Event Health**.

**Table view:**

| Column | Description |
|---|---|
| Event Type | The original event type (e.g., `incident.severity_changed.v1`) |
| Consumer | The consumer that failed |
| Original Stream | Source stream |
| Error | Last error message (truncated, expandable) |
| Attempts | Number of delivery attempts |
| First Attempt | Timestamp of first delivery |
| Last Attempt | Timestamp of last delivery |
| Age | Time since first attempt |
| Actions | Replay, Edit & Replay, Drop |

**Actions per message:**

- **Replay** -- republishes the original payload to the original subject. The message gets a new NATS message ID to bypass deduplication. The consumer's Redis idempotency key for the original event ID is deleted to allow reprocessing.
- **Edit & Replay** -- opens a JSON editor pre-populated with the event payload. The operator can modify the `data` field (e.g., fix a missing field), then republish. An audit event is created recording the edit.
- **Drop with reason** -- removes the message from DLQ. Requires a text reason. Creates an `audit.dlq.message_dropped.v1` event.

**Batch actions:**

- **Replay All** -- replays all messages matching current filters.
- **Filters** -- by stream, event type, consumer, date range, error pattern.

### 8.3 Alerting

| Condition | Severity | Alert Channel |
|---|---|---|
| DLQ depth > 100 messages | WARNING | Slack #coescd-ops, PagerDuty (P3) |
| DLQ depth > 500 messages | CRITICAL | Slack #coescd-ops, PagerDuty (P1) |
| DLQ growth rate > 10 messages/min sustained for 5min | CRITICAL | Slack #coescd-ops, PagerDuty (P1) |
| Consumer lag > 30s sustained for 5min | WARNING | Slack #coescd-ops |
| Consumer lag > 5min sustained for 2min | CRITICAL | Slack #coescd-ops, PagerDuty (P2) |
| Consumer offline (no heartbeat for 60s) | CRITICAL | Slack #coescd-ops, PagerDuty (P2) |

Metrics are exposed via Prometheus:

```
sentinel_dlq_depth{stream="STREAM_DLQ"} 12
sentinel_dlq_growth_rate_per_minute{stream="STREAM_DLQ"} 0.3
sentinel_consumer_lag_seconds{consumer="chat-incident.created.v1", stream="STREAM_INCIDENT"} 0.42
sentinel_consumer_last_heartbeat_at{consumer="chat-incident.created.v1"} 1710510727
sentinel_outbox_unpublished_count{schema="incident"} 0
```

### 8.4 DLQ API

All DLQ endpoints require the `admin:events:manage` permission.

```
GET  /api/v1/admin/events/dlq
     ?filter[stream]=STREAM_INCIDENT
     &filter[type]=incident.severity_changed.v1
     &filter[consumer]=chat-incident.severity_changed.v1
     &filter[after]=2026-03-15T00:00:00Z
     &filter[before]=2026-03-16T00:00:00Z
     &cursor=<opaque>
     &limit=50

GET  /api/v1/admin/events/dlq/:id

POST /api/v1/admin/events/dlq/:id/replay
     Response: { replayed: true, newMessageId: "..." }

POST /api/v1/admin/events/dlq/:id/edit-replay
     Body: { payload: { ...modified event... } }
     Response: { replayed: true, newMessageId: "...", auditEventId: "..." }

POST /api/v1/admin/events/dlq/:id/drop
     Body: { reason: "Known bug in chat consumer, fixed in v2.4.1" }
     Response: { dropped: true, auditEventId: "..." }

POST /api/v1/admin/events/dlq/replay-all
     ?filter[stream]=STREAM_INCIDENT
     &filter[type]=incident.severity_changed.v1
     Response: { replayedCount: 47, failedCount: 0 }

GET  /api/v1/admin/events/health
     Response: {
       dlqDepth: 12,
       dlqGrowthRatePerMinute: 0.3,
       consumers: [
         {
           name: "chat-incident.created.v1",
           stream: "STREAM_INCIDENT",
           lagSeconds: 0.42,
           lastHeartbeat: "2026-03-15T14:32:07.000Z",
           status: "healthy"
         },
         ...
       ],
       outboxBacklog: {
         iam: 0, incident: 0, task: 0, document: 0,
         chat: 0, call: 0, gis: 0, file: 0,
         analytics: 0, audit: 0
       }
     }
```

---

## 9. Schema Registry

### 9.1 Location

All event schemas live in the monorepo at `packages/contracts/events/`, organized by domain and event name. Each version of each event has its own JSON Schema file.

```
packages/contracts/events/
├── incident/
│   ├── created/
│   │   └── v1.json
│   ├── updated/
│   │   └── v1.json
│   ├── status_changed/
│   │   └── v1.json
│   ├── severity_changed/
│   │   └── v1.json
│   ├── commander_assigned/
│   │   └── v1.json
│   ├── participant_added/
│   │   └── v1.json
│   ├── participant_removed/
│   │   └── v1.json
│   ├── sitrep.submitted/
│   │   └── v1.json
│   ├── geofence_updated/
│   │   └── v1.json
│   ├── epicenter_updated/
│   │   └── v1.json
│   ├── child_linked/
│   │   └── v1.json
│   ├── closed/
│   │   └── v1.json
│   └── reopened/
│       └── v1.json
├── iam/
│   ├── user.created/
│   │   └── v1.json
│   ├── user.updated/
│   │   └── v1.json
│   ├── user.deactivated/
│   │   └── v1.json
│   ├── role.assigned/
│   │   └── v1.json
│   ├── role.revoked/
│   │   └── v1.json
│   ├── clearance.changed/
│   │   └── v1.json
│   ├── session.opened/
│   │   └── v1.json
│   ├── session.closed/
│   │   └── v1.json
│   ├── mfa.enrolled/
│   │   └── v1.json
│   ├── policy.changed/
│   │   └── v1.json
│   ├── breakglass.activated/
│   │   └── v1.json
│   ├── breakglass.expired/
│   │   └── v1.json
│   ├── tenant.created/
│   │   └── v1.json
│   └── tenant.suspended/
│       └── v1.json
├── task/
│   ├── created/
│   │   └── v1.json
│   ├── updated/
│   │   └── v1.json
│   ├── assigned/
│   │   └── v1.json
│   ├── status_changed/
│   │   └── v1.json
│   ├── sla_breached/
│   │   └── v1.json
│   ├── completed/
│   │   └── v1.json
│   ├── commented/
│   │   └── v1.json
│   ├── dependency_added/
│   │   └── v1.json
│   └── dependency_removed/
│       └── v1.json
├── document/
│   ├── created/
│   │   └── v1.json
│   ├── version_added/
│   │   └── v1.json
│   ├── review_requested/
│   │   └── v1.json
│   ├── approved/
│   │   └── v1.json
│   ├── rejected/
│   │   └── v1.json
│   ├── signed/
│   │   └── v1.json
│   ├── published/
│   │   └── v1.json
│   ├── revoked/
│   │   └── v1.json
│   └── archived/
│       └── v1.json
├── chat/
│   ├── message.posted/
│   │   └── v1.json
│   ├── message.redacted/
│   │   └── v1.json
│   ├── channel.created/
│   │   └── v1.json
│   └── channel.archived/
│       └── v1.json
├── call/
│   ├── started/
│   │   └── v1.json
│   ├── joined/
│   │   └── v1.json
│   ├── left/
│   │   └── v1.json
│   ├── ended/
│   │   └── v1.json
│   └── recording_ready/
│       └── v1.json
├── gis/
│   ├── layer.created/
│   │   └── v1.json
│   ├── layer.published/
│   │   └── v1.json
│   ├── layer.deleted/
│   │   └── v1.json
│   ├── feature.created/
│   │   └── v1.json
│   ├── feature.updated/
│   │   └── v1.json
│   ├── feature.deleted/
│   │   └── v1.json
│   └── feature.bulk_imported/
│       └── v1.json
├── file/
│   ├── uploaded/
│   │   └── v1.json
│   ├── scanned/
│   │   └── v1.json
│   ├── scan_failed/
│   │   └── v1.json
│   ├── variant_ready/
│   │   └── v1.json
│   └── deleted/
│       └── v1.json
├── analytics/
│   └── report.generated/
│       └── v1.json
├── notification/
│   ├── sent/
│   │   └── v1.json
│   ├── delivered/
│   │   └── v1.json
│   └── failed/
│       └── v1.json
└── audit/
    ├── export.ready/
    │   └── v1.json
    └── chain.broken/
        └── v1.json
```

### 9.2 CI Validation

**Producer-side validation (outbox relay):**

| Environment | Behavior |
|---|---|
| Development / Staging | Payload validated against JSON Schema at publish time. Validation failure throws, preventing outbox row creation. |
| Production | Validation runs but failures are logged as warnings, not thrown. This avoids blocking business operations due to schema drift. |

**Consumer-side validation:**

| Environment | Behavior |
|---|---|
| Development / Staging | Payload validated on receive. Validation failure causes NACK (triggers redelivery / DLQ). |
| Production | Validation runs but failures are logged. Consumer proceeds with best-effort processing. |

**CI pipeline contract tests:**

1. **Producer contract tests** -- for each event type, the producer module has a test that constructs a realistic event payload and validates it against the JSON Schema. This runs on every PR.
2. **Consumer contract tests** -- for each consumed event type, the consumer module has a test that deserializes a fixture payload and exercises the handler. Fixtures are stored alongside schemas.
3. **Breaking change detection** -- a CI job diffs the JSON Schemas between the PR branch and `main`. It flags as a failing check if:
   - A `required` field is removed
   - A field type changes
   - An enum value is removed
   - A field is renamed (detected as removal + addition)
   - Any of these changes occur without a version bump (new `v<n+1>` directory)

```typescript
// Example: CI contract test for incident.severity_changed.v1 producer
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '@sentinel/contracts/events/incident/severity_changed/v1.json';

describe('incident.severity_changed.v1 producer contract', () => {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  it('should produce a valid payload', () => {
    const data = {
      previousSeverity: 'high',
      newSeverity: 'critical',
      reason: 'Dam breach confirmed',
    };

    const valid = validate(data);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });
});
```

### 9.3 Schema Example

Full JSON Schema for `incident.severity_changed.v1`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "sentinel://contracts/events/incident/severity_changed/v1.json",
  "title": "incident.severity_changed.v1",
  "description": "Published when an incident's severity level is changed by a user or automated rule.",
  "type": "object",
  "required": ["previousSeverity", "newSeverity", "reason"],
  "additionalProperties": false,
  "properties": {
    "previousSeverity": {
      "type": "string",
      "enum": ["low", "moderate", "high", "critical", "catastrophic"],
      "description": "The severity level before the change."
    },
    "newSeverity": {
      "type": "string",
      "enum": ["low", "moderate", "high", "critical", "catastrophic"],
      "description": "The severity level after the change."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000,
      "description": "Human-readable justification for the severity change. Required for audit trail."
    }
  },
  "examples": [
    {
      "previousSeverity": "high",
      "newSeverity": "critical",
      "reason": "Dam breach confirmed, downstream evacuation required"
    },
    {
      "previousSeverity": "critical",
      "newSeverity": "moderate",
      "reason": "Floodwaters receding. No further structural threats identified."
    }
  ]
}
```

---

## 10. Event Versioning

### 10.1 Rules

1. **v1 is permanent.** Once published, a version is never deleted from the schema registry or the codebase. It may be marked as deprecated.
2. **Breaking changes require a new version.** The producer ships a `.v2` (or `.v3`, etc.) and publishes both versions simultaneously for at least 2 release cycles.
3. **Non-breaking changes are additive.** A new optional field can be added to an existing version's schema without a version bump.
4. **Consumers opt in to new versions.** A consumer is never forced to upgrade. It continues receiving `.v1` until it explicitly subscribes to `.v2`.
5. **Deprecation, not deletion.** When `.v1` stops being published (after the migration window), the schema file remains in the registry with a `"deprecated": true` flag.

### 10.2 Breaking vs Non-Breaking Changes

| Change | Breaking? | Required Action |
|---|---|---|
| Add optional field to `data` | No | Update existing schema, add property without adding to `required` |
| Add required field to `data` | **Yes** | New version (v2) |
| Remove field from `data` | **Yes** | New version (v2) |
| Change field type (e.g., `string` to `number`) | **Yes** | New version (v2) |
| Rename field | **Yes** | New version (v2) |
| Change field semantics (same type, different meaning) | **Yes** | New version (v2) |
| Narrow an enum (remove a value) | **Yes** | New version (v2) |
| Widen an enum (add a value) | No | Update existing schema |
| Change `additionalProperties` from `false` to `true` | No | Update existing schema |
| Change `additionalProperties` from `true` to `false` | **Yes** | New version (v2) |

### 10.3 Migration Process

Step-by-step process for migrating `incident.severity_changed` from `v1` to `v2`:

**Step 1: Create v2 schema**

```
packages/contracts/events/incident/severity_changed/
├── v1.json          # existing, untouched
└── v2.json          # new
```

The v2 schema contains the breaking change (e.g., `reason` split into `reason` and `reasonCategory`).

**Step 2: Define v2 TypeScript interface**

```typescript
// packages/contracts/src/events/incident/severity-changed.v2.ts

interface IncidentSeverityChangedV2Data {
  previousSeverity: 'low' | 'moderate' | 'high' | 'critical' | 'catastrophic';
  newSeverity: 'low' | 'moderate' | 'high' | 'critical' | 'catastrophic';
  reason: string;
  reasonCategory: 'field_report' | 'sensor_data' | 'satellite_imagery' | 'analyst_assessment' | 'automated_rule';
  triggeredByEventId: string | null;
}
```

**Step 3: Update producer to emit both versions**

```typescript
// See dual publishing code in Section 10.4
```

**Step 4: Deploy producer**

After deployment, both `coescd.incident.severity_changed.v1` and `coescd.incident.severity_changed.v2` flow through NATS. Existing consumers continue processing v1 without changes.

**Step 5: Migrate consumers one by one**

Each consuming team updates their consumer to subscribe to `.v2` instead of `.v1`. They run contract tests against the v2 schema. They deploy independently.

**Step 6: Stop emitting v1 (after 2+ release cycles)**

Once all consumers have migrated to v2 (verified via NATS consumer monitoring -- the v1 consumer should have 0 pending messages and 0 redeliveries):

1. Remove v1 emission from the producer.
2. Delete the NATS durable consumers for v1.
3. Add `"deprecated": true` to the v1 JSON Schema (do **not** delete the file).

### 10.4 Dual Publishing Code Example

```typescript
// libs/eventing/src/dual-publisher.ts

import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { DomainEvent } from '@sentinel/contracts';

/**
 * Writes both v1 and v2 of an event to the outbox in a single transaction.
 * Both events share the same correlationId and causationId but have different
 * event IDs and types.
 */
@Injectable()
export class DualEventPublisher {
  /**
   * Publish two versions of the same domain event.
   * Both are written to the outbox in the same transaction as the caller's business write.
   */
  async publishDual<V1, V2>(
    tx: EntityManager,
    schemaName: string,
    params: {
      baseType: string;       // e.g. "incident.severity_changed"
      occurredAt: string;
      tenantId: string;
      actor: DomainEvent['actor'];
      subject: DomainEvent['subject'];
      correlationId: string;
      causationId: string;
      v1Data: V1;
      v2Data: V2;
    },
  ): Promise<{ v1EventId: string; v2EventId: string }> {
    const v1EventId = uuidv7();
    const v2EventId = uuidv7();

    const v1Event: DomainEvent<V1> = {
      id: v1EventId,
      type: `${params.baseType}.v1`,
      occurredAt: params.occurredAt,
      tenantId: params.tenantId,
      actor: params.actor,
      subject: params.subject,
      correlationId: params.correlationId,
      causationId: params.causationId,
      data: params.v1Data,
      schema: `sentinel://contracts/events/${params.baseType.replace(/\./g, '/')}/v1.json`,
    };

    const v2Event: DomainEvent<V2> = {
      id: v2EventId,
      type: `${params.baseType}.v2`,
      occurredAt: params.occurredAt,
      tenantId: params.tenantId,
      actor: params.actor,
      subject: params.subject,
      correlationId: params.correlationId,
      causationId: params.causationId,
      data: params.v2Data,
      schema: `sentinel://contracts/events/${params.baseType.replace(/\./g, '/')}/v2.json`,
    };

    // Write both to outbox in the same transaction
    await tx.query(
      `INSERT INTO ${schemaName}.outbox (id, type, payload) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        v1Event.id, v1Event.type, JSON.stringify(v1Event),
        v2Event.id, v2Event.type, JSON.stringify(v2Event),
      ],
    );

    return { v1EventId, v2EventId };
  }
}
```

Usage in the incident service:

```typescript
// apps/api/src/incident/incident.service.ts

@Injectable()
export class IncidentService {
  constructor(
    @InjectEntityManager() private readonly em: EntityManager,
    private readonly dualPublisher: DualEventPublisher,
  ) {}

  async changeSeverity(
    incidentId: string,
    dto: ChangeSeverityDto,
    actor: ActorContext,
  ): Promise<Incident> {
    return this.em.transaction(async (tx) => {
      const incident = await tx.findOneOrFail(Incident, { where: { id: incidentId } });
      const previousSeverity = incident.severity;
      incident.severity = dto.newSeverity;
      await tx.save(incident);

      // Build v1 data (original shape)
      const v1Data: IncidentSeverityChangedV1Data = {
        previousSeverity,
        newSeverity: dto.newSeverity,
        reason: dto.reason,
      };

      // Build v2 data (new shape with reasonCategory)
      const v2Data: IncidentSeverityChangedV2Data = {
        previousSeverity,
        newSeverity: dto.newSeverity,
        reason: dto.reason,
        reasonCategory: dto.reasonCategory ?? 'analyst_assessment',
        triggeredByEventId: dto.triggeredByEventId ?? null,
      };

      await this.dualPublisher.publishDual(tx, 'incident', {
        baseType: 'incident.severity_changed',
        occurredAt: new Date().toISOString(),
        tenantId: actor.tenantId,
        actor: { type: 'user', id: actor.userId, ip: actor.ip },
        subject: { type: 'incident', id: incidentId },
        correlationId: actor.correlationId,
        causationId: actor.correlationId, // root event
        v1Data,
        v2Data,
      });

      return incident;
    });
  }
}
```

**Consumer migration example:**

```typescript
// Before migration: consuming v1
@Injectable()
export class ChatSeverityChangedConsumer extends IdempotentConsumer {
  protected readonly consumerName = 'chat-incident.severity_changed.v1';
  // filterSubject: 'coescd.incident.severity_changed.v1'

  protected async handle(event: DomainEvent<IncidentSeverityChangedV1Data>): Promise<void> {
    await this.chatService.postSystemMessage(
      event.subject.id,
      `Severity changed from ${event.data.previousSeverity} to ${event.data.newSeverity}: ${event.data.reason}`,
    );
  }
}

// After migration: consuming v2
@Injectable()
export class ChatSeverityChangedConsumer extends IdempotentConsumer {
  protected readonly consumerName = 'chat-incident.severity_changed.v2';
  // filterSubject: 'coescd.incident.severity_changed.v2'

  protected async handle(event: DomainEvent<IncidentSeverityChangedV2Data>): Promise<void> {
    const icon = event.data.reasonCategory === 'automated_rule' ? '[AUTO]' : '';
    await this.chatService.postSystemMessage(
      event.subject.id,
      `${icon} Severity changed from ${event.data.previousSeverity} to ${event.data.newSeverity}: ${event.data.reason} (${event.data.reasonCategory})`,
    );
  }
}
```

---

## Appendix A: Quick Reference

### Event Count by Module

| Module | Events Produced | Events Consumed (unique types) |
|---|---|---|
| IAM | 14 | 0 |
| Incident | 13 | 4 |
| Task | 9 | 3 |
| Document | 9 | 2 |
| Chat | 4 | 8 |
| Call | 5 | 0 |
| GIS | 7 | 3 |
| File | 5 | 1 |
| Analytics | 1 | all |
| Audit | 2 | all |
| Notification | 3 | 25+ |
| **Total** | **72** | -- |

### Key Configuration Values

| Parameter | Value |
|---|---|
| Outbox poll interval | 100ms |
| Outbox batch size | 100 |
| NATS dedupe window | 120s |
| Consumer MaxDeliver | 8 |
| Consumer AckWait | 30s |
| Consumer MaxAckPending | 1000 |
| Idempotency lock TTL (processing) | 5 minutes |
| Idempotency lock TTL (confirmed) | 24 hours |
| Stream MaxAge (domain) | 7 days |
| Stream MaxAge (audit/DLQ) | 30 days |
| Outbox purge interval | hourly |
| Outbox purge threshold | 24 hours after published |
