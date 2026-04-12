# Sentinel -- National Disaster Management Platform: Data Flow Architecture

> **Version:** 1.0.0
> **Date:** 2026-04-12
> **Status:** Approved
> **Classification:** INTERNAL
> **Audience:** Engineering, DevOps, Architecture Review Board
> **Companion Docs:** [System Design](./system-design.md) | [Event System](./eventing.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Request-Response Flow](#2-request-response-flow)
3. [Event Propagation Flow](#3-event-propagation-flow)
4. [Realtime Architecture](#4-realtime-architecture)
5. [Resync Protocol](#5-resync-protocol)
6. [BFF Aggregation](#6-bff-aggregation)
7. [Search Indexing Flow](#7-search-indexing-flow)
8. [File Processing Pipeline](#8-file-processing-pipeline)
9. [Cross-Module Data Flow Scenarios](#9-cross-module-data-flow-scenarios)
10. [Data Consistency Model](#10-data-consistency-model)

---

## 1. Overview

Data in Sentinel flows through three primary patterns. Every feature in the platform is composed of one or more of these patterns working together.

### 1.1 Three Flow Patterns

| # | Pattern | Transport | Consistency | Latency Target |
|---|---------|-----------|-------------|----------------|
| 1 | **Request-Response** (synchronous) | HTTPS / HTTP/2 | Strong (within single DB transaction) | p95 < 250ms reads, p99 < 600ms writes |
| 2 | **Event Propagation** (asynchronous) | PostgreSQL outbox + NATS JetStream | Eventual (at-least-once, idempotent consumers) | p95 < 1s end-to-end |
| 3 | **Realtime Delivery** | NATS + Socket.IO over WebSocket | Best-effort with resync guarantee | p95 < 500ms from DB commit to client receipt |

### 1.2 Design Principle

A REST handler may publish events (by writing to the outbox within its DB transaction) but must **NEVER** `await` a downstream subscriber. The HTTP response completes independently of event processing. This rule is non-negotiable -- it prevents temporal coupling and ensures that a slow or failing consumer cannot degrade the API.

Eventual consistency is not a bug. It is a deliberate design choice documented per use case in [Section 10](#10-data-consistency-model).

### 1.3 Unified Data Flow Diagram

```
                              SENTINEL DATA FLOW -- ALL THREE PATTERNS
  ========================================================================================

  PATTERN 1: REQUEST-RESPONSE (synchronous)
  ------------------------------------------

  Browser ──HTTPS──► Edge (Nginx) ──mTLS──► BFF (Next.js) ──HTTP/2──► API Gateway (NestJS)
                     TLS 1.3               session→JWT               JWT validation
                     WAF                   aggregation               tenant context
                     rate limit                                      correlation ID
                                                                          │
                                                          ┌───────────────┘
                                                          ▼
                                                    AuthGuard ──► PDP (IAM)
                                                          │        RBAC + ABAC
                                                          ▼        Redis cache
                                                    Controller
                                                    ValidationPipe
                                                          │
                                                          ▼
                                                      Service
                                                    domain logic
                                                    state machine
                                                          │
                                                          ▼
                                                    ┌─── DB Tx ───┐
                                                    │ 1. SET LOCAL │
                                                    │ 2. INSERT    │
                                                    │ 3. outbox    │
                                                    │ 4. COMMIT    │
                                                    └──────┬───────┘
                                                           │
                               201 { data } ◄──────────────┘
                               ◄── back through BFF ── Edge ── Browser


  PATTERN 2: EVENT PROPAGATION (asynchronous)
  --------------------------------------------

  ┌─────────────────┐   poll 100ms    ┌─────────────┐  publish    ┌──────────────────┐
  │ incident.outbox │ ◄─────────────  │ Outbox Relay │ ─────────► │ NATS JetStream   │
  │ (PostgreSQL)    │  read unpub'd   │ (NestJS cron)│            │ STREAM_INCIDENT  │
  └─────────────────┘  mark published └─────────────┘            └────────┬─────────┘
                                                                          │
                                               ┌──────────────────────────┼──────────────────────┐
                                               │              │           │          │            │
                                               ▼              ▼           ▼          ▼            ▼
                                         notification   analytics    audit     search-indexer  chat-room
                                         ─────────────  ──────────  ────────  ──────────────  ──────────
                                         push/SMS/email  fact table  HMAC log  OpenSearch idx  create room
                                                                                               emit event
                                                                                                   │
                                                                                                   ▼
                                                                                           chat.channel.
                                                                                           created.v1
                                                                                           (cascade)

  PATTERN 3: REALTIME DELIVERY
  -----------------------------

  NATS JetStream                                              Browser / Mobile
       │                                                           ▲
       │  consumer: realtime-fanout                                │
       ▼                                                           │ WebSocket
  ┌─────────────────────┐   Socket.IO    ┌──────────────────┐      │
  │ Realtime Gateway    │ ─────────────► │ Redis Adapter    │ ─────┘
  │ (NestJS, separate   │   pub/sub      │ (cross-node      │
  │  deployment)        │                │  fan-out)         │
  └─────────────────────┘                └──────────────────┘
       │                                        │
       │  writes to Redis Stream                │  reads on reconnect
       ▼                                        ▼
  ┌──────────────────────────────────────────────────┐
  │ rt:stream:{scope}  (5-min buffer, maxlen 1000)   │
  │ Used for resync on reconnect                     │
  └──────────────────────────────────────────────────┘
```

---

## 2. Request-Response Flow

This section traces a synchronous API call end-to-end, using **"Create Incident"** as the canonical example.

### 2.1 Full Call Chain

```
Browser (Next.js client)
  → HTTPS POST /api/v1/incidents
  → Edge (Nginx/Envoy): TLS termination, WAF, rate limit check
  → BFF (Next.js API route): validates session cookie, attaches JWT, proxies to backend
  → API Gateway (NestJS): extracts JWT, validates signature, sets app.tenant_id
  → AuthGuard: builds evaluation context, calls PDP (IAM module)
  → PDP: checks RBAC + ABAC policies → ALLOW
  → IncidentController: validates DTO (class-validator)
  → IncidentService: business logic, state machine check
  → DB Transaction:
      1. SET LOCAL app.tenant_id = '...'
      2. INSERT INTO incident.incidents
      3. INSERT INTO incident.timeline (initial entry)
      4. INSERT INTO incident.outbox (incident.created.v1 event)
      5. COMMIT
  → Response 201 { data: IncidentDto }
  ← Back through BFF → Edge → Browser
```

### 2.2 NestJS Interceptor/Guard Chain

Every request passes through this pipeline in order. Failure at any stage short-circuits the chain and returns an appropriate error response.

```
Incoming HTTP Request
  │
  ├── 1. LoggingInterceptor          Assigns X-Request-Id (UUIDv7), records start time,
  │                                   logs method + URL + user agent. On response, logs
  │                                   status code + duration. Emits OpenTelemetry span.
  │
  ├── 2. RateLimitGuard              Checks Redis token bucket: key = tenant:{id}:endpoint:{hash}
  │                                   Burst: 100 req/s per tenant per endpoint.
  │                                   Sustained: 1000 req/min. Returns 429 on exceed.
  │
  ├── 3. AuthGuard                   Extracts Bearer JWT from Authorization header.
  │                                   Validates signature (RS256, JWKS endpoint).
  │                                   Decodes claims: sub, tenantId, roles, clearance.
  │                                   Sets request.user context.
  │
  ├── 4. RolesGuard                  Reads @Roles() decorator from controller method.
  │                                   Checks JWT roles against required roles (RBAC).
  │                                   For ABAC: calls PDP with evaluation context
  │                                   (resource type, action, user attributes, resource
  │                                   attributes). PDP result cached in Redis (30s TTL).
  │                                   Returns 403 on deny.
  │
  ├── 5. ValidationPipe              Runs class-validator on request body DTO.
  │                                   Strips unknown properties (whitelist: true).
  │                                   Returns 400 with field-level errors on failure.
  │
  ├── 6. IdempotencyInterceptor      Checks Idempotency-Key header for POST/PUT/PATCH.
  │                                   Looks up Redis key idempotency:{key}:{tenantId}.
  │                                   If found: returns cached response (skip handler).
  │                                   If not: proceeds, caches response (TTL 24h).
  │
  └── 7. Controller → Service → Repository → DB
```

### 2.3 Layer-by-Layer Detail

#### Edge Layer (Nginx / Envoy)

| Concern | Implementation |
|---------|---------------|
| TLS termination | TLS 1.3 only. ECDSA P-256 certificates. OCSP stapling enabled. |
| WAF | ModSecurity / Envoy ext_authz. Rules: SQL injection, XSS, path traversal, oversized bodies (>10MB rejected). |
| Rate limiting | Redis token bucket (shared across edge nodes). Per-IP for unauthenticated, per-tenant for authenticated. |
| Internal transport | mTLS between edge and BFF, between BFF and API Gateway. Certificates issued by internal CA (Vault PKI). |
| Request ID | If `X-Request-Id` header is absent, edge generates UUIDv7 and attaches it. Propagated through all layers. |
| Compression | Brotli for text responses >1KB. gzip fallback. |
| CORS | Enforced at edge. Allowed origins from environment config. |

#### BFF Layer (Next.js)

```typescript
// apps/web/src/app/api/v1/incidents/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookie } from '@/lib/auth/session';
import { backendClient } from '@/lib/backend-client';

export async function POST(req: NextRequest) {
  // 1. Validate session cookie (HttpOnly, Secure, SameSite=Strict)
  const session = await getSessionFromCookie(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // 2. Parse and forward body
  const body = await req.json();

  // 3. Proxy to backend API Gateway over HTTP/2 mTLS
  const response = await backendClient.post('/api/v1/incidents', body, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Request-Id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
      'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '',
    },
  });

  // 4. Return response to browser
  return NextResponse.json(response.data, { status: response.status });
}
```

Key responsibilities:

- **Cookie-to-JWT translation:** Browser holds an HttpOnly session cookie. BFF resolves it to a JWT for backend calls.
- **Request aggregation:** For pages needing multiple backend calls, BFF parallelizes them (see [Section 6](#6-bff-aggregation)).
- **Server Components:** Next.js Server Components fetch data at render time via the same `backendClient`, enabling SSR with full auth context.

#### API Gateway (NestJS)

```typescript
// apps/api/src/common/middleware/tenant-context.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: () => void) {
    const tenantId = req['user']?.tenantId;
    if (tenantId) {
      // SET LOCAL scopes the variable to the current transaction.
      // Combined with RLS policies, this prevents cross-tenant data access.
      await this.dataSource.query(`SET LOCAL app.tenant_id = $1`, [tenantId]);
    }
    next();
  }
}
```

Gateway responsibilities:

| Concern | Detail |
|---------|--------|
| JWT validation | RS256 signature check against JWKS. Token expiry check. `iss` and `aud` claim validation. |
| Tenant injection | `SET LOCAL app.tenant_id` for PostgreSQL RLS enforcement. |
| Correlation | `X-Request-Id` propagated to all internal calls and log entries. |
| Audit middleware | Writes request metadata (actor, action, resource) to audit context, consumed by service layer. |
| Timeout | Global 30s request timeout. Per-route overrides for long operations (e.g., bulk import: 120s). |

#### AuthGuard + PDP

```typescript
// apps/api/src/modules/iam/guards/abac.guard.ts
@Injectable()
export class AbacGuard implements CanActivate {
  constructor(
    private readonly pdp: PolicyDecisionPoint,
    private readonly reflector: Reflector,
    private readonly cache: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<string>(
      'permission',
      context.getHandler(),
    );
    if (!requiredPermission) return true; // no permission decorator = public

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const resourceId = req.params.id;

    // 1. Build evaluation context
    const evalCtx: EvaluationContext = {
      subject: {
        id: user.sub,
        tenantId: user.tenantId,
        roles: user.roles,
        clearance: user.clearance,
      },
      action: requiredPermission,
      resource: {
        type: this.reflector.get<string>('resource_type', context.getClass()),
        id: resourceId,
      },
      environment: {
        ip: req.ip,
        timestamp: new Date().toISOString(),
      },
    };

    // 2. Check cache (30s TTL)
    const cacheKey = `pdp:${user.sub}:${requiredPermission}:${resourceId ?? '*'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return cached === 'ALLOW';

    // 3. Evaluate policy
    const decision = await this.pdp.evaluate(evalCtx);
    await this.cache.set(cacheKey, decision.effect, 30);

    return decision.effect === 'ALLOW';
  }
}
```

PDP evaluation order:

1. **Deny-first:** Explicit DENY rules always win.
2. **RBAC check:** User roles contain required permission? If yes, proceed. If no ABAC rules exist, deny.
3. **ABAC check:** Attribute-based conditions (clearance level >= resource classification, user belongs to incident team, time-of-day restrictions).
4. **Default deny:** No matching rule = DENY.

#### Controller

```typescript
// apps/api/src/modules/incident/controllers/incident.controller.ts
@Controller('api/v1/incidents')
@ResourceType('incident')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Post()
  @Permission('incident.create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ApiResponse<IncidentDto>> {
    const incident = await this.incidentService.create(dto, user);
    return {
      data: IncidentDto.from(incident),
      meta: { requestId: user.requestId },
    };
  }
}
```

- `CreateIncidentDto` is validated by `ValidationPipe` (class-validator decorators).
- `@Permission('incident.create')` is read by `AbacGuard`.
- `@CurrentUser()` is a custom parameter decorator extracting the authenticated user from the request.

#### Service + Transaction (Outbox Pattern)

```typescript
// apps/api/src/modules/incident/services/incident.service.ts
@Injectable()
export class IncidentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly incidentRepo: IncidentRepository,
    private readonly timelineRepo: TimelineRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly stateMachine: IncidentStateMachine,
  ) {}

  async create(
    dto: CreateIncidentDto,
    actor: AuthenticatedUser,
  ): Promise<Incident> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Tenant context for RLS
      await manager.query(`SET LOCAL app.tenant_id = $1`, [actor.tenantId]);

      // 2. Create incident aggregate
      const incident = Incident.create({
        tenantId: actor.tenantId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        severity: dto.severity,
        location: dto.location, // PostGIS point
        reportedBy: actor.sub,
      });

      // 3. Validate state machine allows creation
      this.stateMachine.assertCanTransition(null, IncidentStatus.REPORTED);

      // 4. Persist incident
      const saved = await this.incidentRepo.save(incident, manager);

      // 5. Create initial timeline entry
      await this.timelineRepo.save(
        TimelineEntry.create({
          incidentId: saved.id,
          tenantId: actor.tenantId,
          kind: TimelineEntryKind.STATUS_CHANGE,
          actorId: actor.sub,
          data: { from: null, to: IncidentStatus.REPORTED },
        }),
        manager,
      );

      // 6. Write to outbox (same transaction -- atomic with business write)
      await this.outboxRepo.save(
        OutboxEntry.create({
          aggregateType: 'incident',
          aggregateId: saved.id,
          eventType: 'incident.created.v1',
          tenantId: actor.tenantId,
          payload: {
            id: saved.id,
            tenantId: actor.tenantId,
            title: saved.title,
            category: saved.category,
            severity: saved.severity,
            status: saved.status,
            location: saved.location,
            reportedBy: actor.sub,
          },
          actor: {
            type: 'user',
            id: actor.sub,
            ip: actor.ip,
          },
          correlationId: actor.requestId,
        }),
        manager,
      );

      // 7. COMMIT happens automatically when this function returns
      return saved;
    });
  }
}
```

The critical invariant: **steps 4, 5, and 6 share the same PostgreSQL transaction**. If any step fails, all roll back. The event is never published without the business write succeeding, and the business write is never committed without the event being recorded.

#### Repository + RLS

```sql
-- Row-Level Security policy on incident.incidents
ALTER TABLE incident.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON incident.incidents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation ON incident.incidents
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Every table in every schema has an identical RLS policy. Combined with `SET LOCAL app.tenant_id`, this provides defense-in-depth tenant isolation at the database level, independent of application logic.

### 2.4 Error Handling

| Layer | Error | HTTP Status | Behavior |
|-------|-------|-------------|----------|
| Edge | Rate limit exceeded | 429 | `Retry-After` header set. Logged. |
| Edge | WAF rule triggered | 403 | Request blocked. Security alert emitted. |
| BFF | Session expired | 401 | Redirect to login. |
| BFF | Backend timeout (>3s) | 504 | Partial response with degraded flag (see BFF aggregation). |
| Gateway | Invalid JWT | 401 | `WWW-Authenticate: Bearer error="invalid_token"` |
| Guard | RBAC/ABAC deny | 403 | Error body includes `requiredPermission` in development. |
| Validation | DTO validation failure | 400 | Array of `{ field, constraint, message }` errors. |
| Service | Business rule violation | 409 / 422 | Domain-specific error code (e.g., `INCIDENT_ALREADY_CLOSED`). |
| Repository | Unique constraint | 409 | Mapped to `DUPLICATE_RESOURCE` error code. |
| Repository | RLS violation | 0 rows affected | Treated as 404 (tenant cannot see the row). |
| Transaction | Serialization failure | 500 (auto-retry) | TypeORM retry decorator, up to 3 retries with exponential backoff. |

---

## 3. Event Propagation Flow

After the database transaction commits in the request-response flow, the asynchronous event propagation begins. This section traces how a single event (`incident.created.v1`) cascades through the system.

### 3.1 Outbox Relay

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           OUTBOX RELAY                                     │
│                                                                            │
│  Scheduled task: runs every 100ms (configurable)                           │
│  Concurrency: single leader (PostgreSQL advisory lock)                     │
│                                                                            │
│  1. SELECT * FROM incident.outbox                                          │
│     WHERE published_at IS NULL                                             │
│     ORDER BY created_at ASC                                                │
│     LIMIT 100                                                              │
│     FOR UPDATE SKIP LOCKED;                                                │
│                                                                            │
│  2. For each row:                                                          │
│     a. Build DomainEvent envelope (id, type, occurredAt, tenantId, ...)    │
│     b. Publish to NATS subject: sentinel.incident.created.v1               │
│     c. NATS returns ACK (JetStream publish confirmation)                   │
│                                                                            │
│  3. UPDATE incident.outbox                                                 │
│     SET published_at = now()                                               │
│     WHERE id IN (...published IDs);                                        │
│                                                                            │
│  4. Cleanup: DELETE FROM incident.outbox                                   │
│     WHERE published_at < now() - interval '7 days';                        │
│     (weekly, not every poll cycle)                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

Implementation:

```typescript
// apps/api/src/infrastructure/outbox/outbox-relay.service.ts
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly natsClient: NatsJetStreamClient,
  ) {}

  @Cron('*/100ms') // custom cron expression for sub-second polling
  async relay() {
    // Advisory lock ensures only one instance processes the outbox
    const acquired = await this.dataSource.query(
      `SELECT pg_try_advisory_lock(hashtext('outbox_relay'))`,
    );
    if (!acquired[0].pg_try_advisory_lock) return;

    try {
      const entries: OutboxEntry[] = await this.dataSource.query(`
        SELECT * FROM incident.outbox
        WHERE published_at IS NULL
        ORDER BY created_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `);

      if (entries.length === 0) return;

      const publishedIds: string[] = [];

      for (const entry of entries) {
        const event = this.buildEnvelope(entry);
        const subject = `sentinel.${entry.event_type}`;

        try {
          const ack = await this.natsClient.publish(subject, event);
          if (ack.duplicate) {
            this.logger.warn(`Duplicate event detected: ${entry.id}`);
          }
          publishedIds.push(entry.id);
        } catch (err) {
          this.logger.error(`Failed to publish ${entry.id}: ${err.message}`);
          // Stop processing this batch -- next poll will retry
          break;
        }
      }

      if (publishedIds.length > 0) {
        await this.dataSource.query(
          `UPDATE incident.outbox SET published_at = now() WHERE id = ANY($1)`,
          [publishedIds],
        );
      }
    } finally {
      await this.dataSource.query(
        `SELECT pg_advisory_unlock(hashtext('outbox_relay'))`,
      );
    }
  }

  private buildEnvelope(entry: OutboxEntry): DomainEvent {
    return {
      id: entry.id,
      type: entry.event_type,
      occurredAt: entry.created_at.toISOString(),
      tenantId: entry.tenant_id,
      actor: entry.actor,
      subject: {
        type: entry.aggregate_type,
        id: entry.aggregate_id,
      },
      correlationId: entry.correlation_id,
      causationId: entry.id,
      data: entry.payload,
      schema: `sentinel://contracts/events/${entry.event_type.replace(/\./g, '/')}.json`,
    };
  }
}
```

### 3.2 NATS JetStream Routing

The event `sentinel.incident.created.v1` lands in JetStream:

```
NATS JetStream Configuration:
  Stream: STREAM_INCIDENT
    subjects: ["sentinel.incident.>"]
    retention: WorkQueue (each message delivered to one consumer per group)
    storage: File
    max_age: 7 days
    max_bytes: 10 GB
    replicas: 3
    discard: Old
    duplicate_window: 2 minutes (dedup by Nats-Msg-Id header = event.id)
```

Six durable consumers are bound to `STREAM_INCIDENT`:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  sentinel.incident.created.v1                                            │
│  ═══════════════════════════                                             │
│       │                                                                  │
│       ├──► Consumer: notification-incident                               │
│       │    filter: sentinel.incident.>                                   │
│       │    deliver: push                                                 │
│       │    ack_wait: 30s                                                 │
│       │    max_deliver: 5                                                │
│       │    ┌──────────────────────────────────────────┐                  │
│       │    │ 1. Evaluate notification rules            │                  │
│       │    │    - severity=CRITICAL → broadcast all    │                  │
│       │    │    - severity=HIGH → shift leads + IC     │                  │
│       │    │    - else → reporter + shift leads        │                  │
│       │    │ 2. Create notification.notifications rows │                  │
│       │    │ 3. Dispatch:                              │                  │
│       │    │    - WebSocket push (via NATS)            │                  │
│       │    │    - Mobile push (FCM/APNs)               │                  │
│       │    │    - SMS (Twilio/gov gateway)             │                  │
│       │    │    - Email (SMTP)                         │                  │
│       │    └──────────────────────────────────────────┘                  │
│       │                                                                  │
│       ├──► Consumer: analytics-etl                                       │
│       │    filter: sentinel.incident.>                                   │
│       │    ┌──────────────────────────────────────────┐                  │
│       │    │ 1. INSERT INTO analytics.fact_incident    │                  │
│       │    │    (id, tenant_id, category, severity,    │                  │
│       │    │     status, reported_by, created_at)      │                  │
│       │    │ 2. UPSERT analytics.dim_user              │                  │
│       │    │    (if reporter is new participant)        │                  │
│       │    │ 3. UPSERT analytics.dim_category          │                  │
│       │    └──────────────────────────────────────────┘                  │
│       │                                                                  │
│       ├──► Consumer: audit-writer                                        │
│       │    filter: sentinel.incident.>                                   │
│       │    ┌──────────────────────────────────────────┐                  │
│       │    │ 1. Compute HMAC-SHA256 chain:             │                  │
│       │    │    hash = HMAC(prev_hash + event_json)    │                  │
│       │    │ 2. INSERT INTO audit.events               │                  │
│       │    │    (event_id, type, actor, subject,        │                  │
│       │    │     tenant_id, data, hash, prev_hash)     │                  │
│       │    │ 3. ACK                                    │                  │
│       │    └──────────────────────────────────────────┘                  │
│       │                                                                  │
│       ├──► Consumer: realtime-fanout                                     │
│       │    filter: sentinel.incident.>                                   │
│       │    ┌──────────────────────────────────────────┐                  │
│       │    │ 1. Push to Socket.IO room                 │                  │
│       │    │    "tenant:{tenantId}" (all operators)     │                  │
│       │    │ 2. Push to Socket.IO room                 │                  │
│       │    │    "incident:{incidentId}" (participants)  │                  │
│       │    │ 3. Write to Redis Stream                  │                  │
│       │    │    rt:stream:tenant:{tenantId}             │                  │
│       │    │    rt:stream:incident:{incidentId}         │                  │
│       │    └──────────────────────────────────────────┘                  │
│       │                                                                  │
│       ├──► Consumer: search-indexer                                       │
│       │    filter: sentinel.incident.>                                   │
│       │    ┌──────────────────────────────────────────┐                  │
│       │    │ 1. Build OpenSearch document:              │                  │
│       │    │    { code, title, description, category,   │                  │
│       │    │      severity, status, commander,          │                  │
│       │    │      tenant_id, created_at, location }     │                  │
│       │    │ 2. Upsert to sentinel-incidents index     │                  │
│       │    │    (_id = incident.id)                     │                  │
│       │    └──────────────────────────────────────────┘                  │
│       │                                                                  │
│       └──► Consumer: chat-room-creator                                   │
│            filter: sentinel.incident.created.v1                          │
│            ┌──────────────────────────────────────────┐                  │
│            │ 1. INSERT INTO chat.channels               │                  │
│            │    (kind=INCIDENT_ROOM, incident_id,       │                  │
│            │     name="Incident {code}")                │                  │
│            │ 2. INSERT INTO chat.members                │                  │
│            │    (channel_id, user_id=reporter)          │                  │
│            │ 3. Write to chat.outbox:                   │                  │
│            │    chat.channel.created.v1                 │                  │
│            │    (triggers its OWN consumer cascade)     │                  │
│            └──────────────────────────────────────────┘                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Event Cascade

A single `incident.created.v1` triggers a chain reaction:

```
incident.created.v1                          (t=0ms, outbox relay publishes)
  ├── notification: push/SMS sent            (t+50ms)
  ├── analytics: fact_incident inserted      (t+30ms)
  ├── audit: audit.events row written        (t+20ms)
  ├── realtime: WebSocket push to clients    (t+40ms)
  ├── search: OpenSearch document indexed    (t+100ms)
  └── chat-room-creator:                     (t+80ms)
       └── chat.channel.created.v1           (t+180ms, second outbox relay cycle)
            ├── notification: "Room created"  (t+230ms)
            ├── realtime: channel list update (t+220ms)
            ├── search: index channel         (t+280ms)
            └── audit: audit event written    (t+210ms)
```

### 3.4 Consumer Idempotency

Every consumer deduplicates using a two-phase Redis check:

```typescript
// packages/common/src/events/idempotent-consumer.decorator.ts
export function IdempotentConsumer() {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value;

    descriptor.value = async function (event: DomainEvent, ...args: any[]) {
      const redis: RedisService = this.redis;
      const key = `idem:${this.consumerName}:${event.id}`;

      // SET NX with 24h TTL -- returns 'OK' if key was set (first time)
      const result = await redis.set(key, '1', 'EX', 86400, 'NX');
      if (result !== 'OK') {
        // Already processed -- skip silently
        return;
      }

      try {
        return await original.call(this, event, ...args);
      } catch (err) {
        // Remove idempotency key so retry can re-process
        await redis.del(key);
        throw err;
      }
    };

    return descriptor;
  };
}
```

### 3.5 Timing Expectations

| Stage | Latency | Measured By |
|-------|---------|-------------|
| Outbox relay poll interval | 100ms (max) | Cron schedule |
| Outbox relay batch processing | <50ms for 100 events | OpenTelemetry span |
| NATS publish + ACK | <10ms | NATS client metrics |
| Consumer pickup (push delivery) | <10ms | NATS consumer lag |
| Consumer processing (typical) | <500ms | Consumer span duration |
| **End-to-end: DB commit to WebSocket delivery** | **<1s p95** | Custom instrumentation |
| End-to-end: DB commit to OpenSearch indexed | <5s p95 | Index lag metric |
| End-to-end: DB commit to audit written | <2s p95 | Audit lag metric |
| End-to-end: DB commit to analytics fact | <30s p95 | ETL lag metric |

### 3.6 Dead Letter Handling

After `max_deliver` attempts (5), a failed message moves to the dead letter stream:

```
Stream: STREAM_DLQ
  subjects: ["$JS.EVENT.ADVISORY.MAX_DELIVER.>"]
  retention: Limits
  max_age: 30 days
```

Operations team receives an alert via PagerDuty. DLQ messages can be:
1. **Replayed** via admin endpoint: `POST /admin/events/replay { streamId, sequenceStart, sequenceEnd }`
2. **Inspected** via NATS CLI or admin dashboard
3. **Skipped** with manual ACK (after root cause investigation)

---

## 4. Realtime Architecture

### 4.1 Topology

```
┌─────────────────────┐
│   NATS JetStream    │
│  (event backbone)   │
└──────────┬──────────┘
           │ consumer: realtime-fanout
           ▼
┌─────────────────────────────────────────────────────────┐
│              Realtime Gateway Cluster                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Gateway-1   │  │  Gateway-2   │  │  Gateway-N   │     │
│  │  (NestJS)    │  │  (NestJS)    │  │  (NestJS)    │     │
│  │  Socket.IO   │  │  Socket.IO   │  │  Socket.IO   │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
│         └──────────┬───────┴──────────┬───────┘             │
│                    │                  │                     │
│              ┌─────▼──────┐  ┌───────▼────────┐           │
│              │ Redis Pub/ │  │ Redis Streams   │           │
│              │ Sub Adapter│  │ (resync buffer) │           │
│              └────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────┘
                    │
                    │  WebSocket (wss://)
                    ▼
           ┌───────────────┐
           │    Clients     │
           │  Browser/iOS/  │
           │  Android       │
           └───────────────┘
```

The Realtime Gateway is a **separate NestJS deployment** from the API Gateway. It does not handle REST requests. Its sole purpose is:

1. Accept WebSocket connections from clients.
2. Consume events from NATS (via the `realtime-fanout` consumer).
3. Fan out events to the correct Socket.IO rooms.
4. Buffer recent events in Redis Streams for resync.

The **Redis adapter** (`@socket.io/redis-adapter`) ensures that when Gateway-1 receives an event from NATS and emits it to a room, Gateway-2 and Gateway-N also emit it to their locally connected clients in that room.

### 4.2 Connection Lifecycle

```
Client                          Gateway                         Redis / NATS
  │                                │                                │
  │  1. wss://rt.sentinel.gov/     │                                │
  │     ?token=<JWT>               │                                │
  │ ──────────────────────────►    │                                │
  │                                │  2. Validate JWT               │
  │                                │     (RS256, check exp/iss/aud) │
  │                                │                                │
  │                                │  3. Extract: userId, tenantId, │
  │                                │     roles, clearance           │
  │                                │                                │
  │                                │  4. Join rooms:                │
  │                                │     "tenant:{tenantId}"        │
  │                                │     "user:{userId}"            │
  │                                │ ──────────────────────────►    │
  │                                │     SADD rt:online:{tenantId}  │
  │                                │          userId                │
  │                                │                                │
  │  5. { type: "connected",      │                                │
  │       userId, tenantId }       │                                │
  │ ◄──────────────────────────    │                                │
  │                                │                                │
  │  6. subscribe                  │                                │
  │     { scope: "incident:01H" }  │                                │
  │ ──────────────────────────►    │                                │
  │                                │  7. ABAC check:                │
  │                                │     user is participant OR     │
  │                                │     has incident.read +        │
  │                                │     clearance >= resource      │
  │                                │                                │
  │                                │  8. If allowed: join room      │
  │                                │     "incident:01H..."          │
  │                                │                                │
  │  9. { type: "subscribed",     │                                │
  │       scope: "incident:01H" } │                                │
  │ ◄──────────────────────────    │                                │
  │                                │                                │
  │           ... events flow ...  │                                │
  │                                │                                │
  │  10. disconnect                │                                │
  │ ──────────────────────────►    │                                │
  │                                │  11. SREM rt:online:{tenantId} │
  │                                │           userId               │
  │                                │     Leave all rooms            │
```

### 4.3 Subscription Model

Clients subscribe to **scopes**, not raw NATS subjects. The gateway translates scopes to Socket.IO rooms and enforces authorization.

| Scope | Format | Receives | Auth Check |
|---|---|---|---|
| tenant | implicit (auto on connect) | tenant-wide broadcasts, CRITICAL alerts, system announcements | User belongs to tenant (from JWT) |
| user | implicit (auto on connect) | personal notifications, direct messages, assignment alerts | User is self (from JWT) |
| incident:{id} | explicit `subscribe` | timeline entries, sitreps, participant changes, status transitions | User is incident participant OR has `incident.read` + clearance >= incident classification |
| channel:{id} | explicit `subscribe` | chat messages, typing indicators, member joins/leaves | User is channel member (DB check) |
| map:bbox:{w},{s},{e},{n} | explicit `subscribe` | GIS feature creates/updates/deletes within bounding box | User has `gis.feature.read` permission |

**Authorization re-check:** ABAC is not only checked at subscribe time. On every event fan-out, the gateway checks that the event's classification level does not exceed the socket's clearance level. If a user's clearance is downgraded while connected, the next event delivery triggers an automatic unsubscribe from affected scopes.

### 4.4 Server-to-Client Message Format

All messages from server to client follow a standard envelope:

```json
{
  "type": "incident.timeline.appended",
  "scope": "incident:019512a4-7c2e-7f3a-b8d1-4e3f6a2b9c01",
  "data": {
    "entryId": "019512b1-3f4a-7b8c-9d0e-1f2a3b4c5d6e",
    "kind": "SITREP_SUBMITTED",
    "actorId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "actorName": "Lt. Rahimov",
    "summary": "Eastern sector: 3 buildings collapsed, road blocked at km 47",
    "createdAt": "2026-04-12T14:32:07.841Z"
  },
  "v": 1,
  "eventId": "019512b1-4a5b-7c8d-9e0f-2a3b4c5d6e7f"
}
```

| Field | Purpose |
|-------|---------|
| `type` | Event type for client-side routing / reducer dispatch. |
| `scope` | Which subscription this event belongs to. Client uses this to route to the correct UI component. |
| `data` | Event-specific payload. Shape varies by type. Typed in `packages/contracts`. |
| `v` | Schema version. Matches the `vN` suffix in the event type. |
| `eventId` | UUIDv7. Client stores this as `lastEventId` per scope for resync. |

### 4.5 Client-to-Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ scope: string }` | Request to join a scope. Server validates auth and joins room. |
| `unsubscribe` | `{ scope: string }` | Leave a scope. Server removes from room. |
| `resync` | `{ scope: string, lastEventId: string }` | Request missed events since `lastEventId`. See [Section 5](#5-resync-protocol). |
| `message:send` | `{ channelId, body, kind, attachments?, replyTo? }` | Send a chat message. Server validates membership, persists, and emits to room. |
| `message:typing` | `{ channelId }` | Typing indicator. Ephemeral -- not persisted. Broadcast to channel room. Throttled to 1 per 3s per user. |
| `call:join` | `{ channelId }` | Join a voice/video call. Creates mediasoup transport. |
| `call:leave` | `{ channelId }` | Leave a call. Closes mediasoup transport. |
| `call:produce` | `{ channelId, kind, rtpParameters }` | Start producing media (audio/video). mediasoup signaling. |
| `call:consume` | `{ channelId, producerId }` | Start consuming another participant's media. mediasoup signaling. |

### 4.6 Scaling

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Target connections per pod | 50,000 | Validated via k6 WebSocket load test. Node.js event loop stays <50ms p99 at this level. |
| Target pods (peak) | 10 | 500K total connections. Exceeds 5,000 operators even with multiple tabs/devices. |
| Backpressure | Per-socket outbound queue capped at 256 messages | Slow clients (bad network) cannot cause memory pressure on the gateway. |
| Overflow behavior | Disconnect with code `4290` (BACKPRESSURE) | Client reconnects and initiates resync. Better than dropping random messages. |
| Heartbeat interval | 25s | Keeps NAT/firewall mappings alive. |
| Heartbeat timeout | 60s | Allows for temporary network glitches without premature disconnect. |
| Sticky sessions | Edge load balancer (source IP hash or `io` cookie) | Required for Socket.IO's HTTP long-polling upgrade path. WebSocket-only clients do not strictly need stickiness. |

---

## 5. Resync Protocol

Networks fail. Clients go offline. The resync protocol guarantees that no events are silently lost.

### 5.1 Normal Resync Flow

```
Client                          Gateway                    Redis
  │                                │                          │
  │  (disconnected for 30s)        │                          │
  │                                │                          │
  │  reconnect + auth              │                          │
  │ ──────────────────────────►    │                          │
  │                                │  validate JWT            │
  │                                │  rejoin implicit rooms   │
  │                                │                          │
  │  resync                        │                          │
  │  { scope: "incident:01H...",   │                          │
  │    lastEventId: "019512b1..." }│                          │
  │ ──────────────────────────►    │                          │
  │                                │  XRANGE                  │
  │                                │  rt:stream:incident:01H  │
  │                                │  (019512b1...) +         │
  │                                │ ──────────────────────►  │
  │                                │                          │
  │                                │  ◄── [5 missed events]   │
  │                                │                          │
  │  { type: "resync_batch",       │                          │
  │    scope: "incident:01H...",   │                          │
  │    events: [...5 events],      │                          │
  │    complete: true }            │                          │
  │ ◄──────────────────────────    │                          │
  │                                │                          │
  │  (client applies events,       │                          │
  │   updates lastEventId)         │                          │
```

### 5.2 Redis Stream Buffer

Each scope has a dedicated Redis Stream that buffers recent events for resync:

```
Key:      rt:stream:{scope}
Example:  rt:stream:incident:019512a4-7c2e-7f3a-b8d1-4e3f6a2b9c01

MaxLen:   1000 entries (XTRIM MAXLEN ~ 1000)
TTL:      5 minutes (EXPIRE on every write)

Entry format:
  ID:    Redis-generated stream ID (timestamp-based)
  Fields:
    eventId:  "019512b1-4a5b-7c8d-9e0f-2a3b4c5d6e7f"  (UUIDv7)
    type:     "incident.timeline.appended"
    data:     "{...}"  (JSON string)
    ts:       "1712930527841"  (Unix ms)
```

Write path (in the realtime-fanout consumer):

```typescript
// apps/realtime/src/services/realtime-fanout.service.ts
async fanOut(event: DomainEvent): Promise<void> {
  const scopes = this.resolveScopes(event);

  for (const scope of scopes) {
    const roomMessage: ServerToClientMessage = {
      type: event.type,
      scope,
      data: event.data,
      v: this.extractVersion(event.type),
      eventId: event.id,
    };

    // 1. Emit to Socket.IO room (Redis adapter handles cross-node)
    this.server.to(scope).emit('event', roomMessage);

    // 2. Buffer in Redis Stream for resync
    await this.redis.xadd(
      `rt:stream:${scope}`,
      'MAXLEN', '~', '1000',
      '*',
      'eventId', event.id,
      'type', event.type,
      'data', JSON.stringify(event.data),
      'ts', Date.now().toString(),
    );

    // Refresh TTL
    await this.redis.expire(`rt:stream:${scope}`, 300);
  }
}
```

### 5.3 Full Resync Flow

When the client has been offline longer than the buffer window (>5 minutes) or the `lastEventId` is not found in the stream:

```
Client                          Gateway                    Redis
  │                                │                          │
  │  (disconnected for 10 min)     │                          │
  │                                │                          │
  │  reconnect + auth              │                          │
  │ ──────────────────────────►    │                          │
  │                                │                          │
  │  resync                        │                          │
  │  { scope: "incident:01H...",   │                          │
  │    lastEventId: "01950f..." }  │                          │
  │ ──────────────────────────►    │                          │
  │                                │  XRANGE                  │
  │                                │  rt:stream:incident:01H  │
  │                                │  (01950f...) +           │
  │                                │ ──────────────────────►  │
  │                                │                          │
  │                                │  ◄── [] (empty or        │
  │                                │       ID not found)      │
  │                                │                          │
  │  { type: "resync_full_required",                          │
  │    scope: "incident:01H..." }  │                          │
  │ ◄──────────────────────────    │                          │
  │                                │                          │
  │  (client-side recovery):       │                          │
  │  1. unsubscribe { scope }      │                          │
  │  2. GET /api/v1/incidents/01H  │  (via REST)              │
  │     → full incident state      │                          │
  │  3. subscribe { scope }        │                          │
  │  4. set lastEventId from       │                          │
  │     response.meta.lastEventId  │                          │
```

### 5.4 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Client offline >5 minutes | Always `resync_full_required`. Stream TTL has expired or been trimmed. |
| Client reconnects during network partition | Server may have a different stream buffer. Client trusts server response unconditionally. |
| Multiple rapid reconnections | Client-side debounce: 1s cooldown between resync requests per scope. |
| Server restarts (Redis Stream lost) | Client receives `resync_full_required` for all scopes on reconnect. |
| Concurrent subscribe + resync | Gateway queues operations per socket per scope. Subscribe completes before resync processes. |
| lastEventId is newer than stream head | No missed events. Server returns `resync_batch` with empty events array and `complete: true`. |

### 5.5 Client-Side Implementation

```typescript
// packages/sdk/src/realtime/resync-manager.ts
export class ResyncManager {
  private lastEventIds = new Map<string, string>();
  private resyncCooldowns = new Map<string, number>();

  onEvent(message: ServerToClientMessage): void {
    this.lastEventIds.set(message.scope, message.eventId);
  }

  async onReconnect(socket: Socket): Promise<void> {
    for (const [scope, lastEventId] of this.lastEventIds) {
      // Debounce: skip if resync was requested <1s ago
      const lastResync = this.resyncCooldowns.get(scope) ?? 0;
      if (Date.now() - lastResync < 1000) continue;

      this.resyncCooldowns.set(scope, Date.now());

      socket.emit('resync', { scope, lastEventId });
    }
  }

  onResyncBatch(batch: ResyncBatchMessage): void {
    for (const event of batch.events) {
      // Apply event to local state
      this.eventBus.emit(event.type, event);
      this.lastEventIds.set(batch.scope, event.eventId);
    }
  }

  async onResyncFullRequired(
    scope: string,
    socket: Socket,
    restClient: RestClient,
  ): Promise<void> {
    // 1. Unsubscribe
    socket.emit('unsubscribe', { scope });

    // 2. Fetch current state via REST
    const resource = this.parseScope(scope);
    const state = await restClient.get(resource.restPath);

    // 3. Replace local state entirely
    this.stateStore.replace(scope, state.data);

    // 4. Resubscribe
    socket.emit('subscribe', { scope });

    // 5. Update lastEventId
    if (state.meta?.lastEventId) {
      this.lastEventIds.set(scope, state.meta.lastEventId);
    }
  }
}
```

---

## 6. BFF Aggregation

### 6.1 Purpose

The Next.js BFF (Backend-For-Frontend) exists to eliminate client-side request waterfalls. Instead of the browser making 5-6 sequential API calls to render a page, the BFF makes those calls in parallel on the server side (same data center, <1ms network latency) and returns a single combined response.

### 6.2 Page Aggregation Map

| Page | BFF Endpoint | Backend Calls | Combined Response | Cache TTL |
|---|---|---|---|---|
| Dashboard | `GET /bff/dashboard` | incidents (filtered), tasks (due today), stats, map preview | `DashboardDto` | 10s |
| Incident Detail | `GET /bff/incidents/:id` | incident, timeline (latest 10), tasks (summary), chat (preview), participants, map layers | `IncidentDetailDto` | 5s |
| Task Board | `GET /bff/tasks/board` | tasks (grouped by status), incident summary, participants | `TaskBoardDto` | 5s |
| Document List | `GET /bff/documents` | documents (filtered), approval inbox count | `DocumentListDto` | 15s |
| Chat Channel | `GET /bff/chat/:channelId` | channel, messages (latest 50), members, unread count | `ChatChannelDto` | none |
| Admin Users | `GET /bff/admin/users` | users (paginated), roles, tenant info | `AdminUsersDto` | 15s |

### 6.3 Implementation

```typescript
// apps/web/src/app/api/bff/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookie } from '@/lib/auth/session';
import { backendClient } from '@/lib/backend-client';
import { redisCache } from '@/lib/cache';

interface DashboardDto {
  incidents: IncidentSummary[];
  tasks: TaskSummary[];
  stats: DashboardStats;
  mapPreview: MapPreviewDto;
  _meta: {
    requestId: string;
    degraded: string[]; // list of sections that failed to load
    cachedAt?: string;
  };
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookie(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    'X-Request-Id': requestId,
  };

  // Check cache first
  const cacheKey = `bff:dashboard:${session.tenantId}:${session.userId}`;
  const cached = await redisCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({
      ...JSON.parse(cached),
      _meta: { ...JSON.parse(cached)._meta, cachedAt: new Date().toISOString() },
    });
  }

  // Parallel backend calls with individual timeouts and fallbacks
  const [incidents, tasks, stats, mapPreview] = await Promise.allSettled([
    backendClient.get('/api/v1/incidents', {
      headers,
      params: { status: 'active', limit: 20, sort: '-severity,-createdAt' },
      timeout: 3000,
    }),
    backendClient.get('/api/v1/tasks', {
      headers,
      params: { dueBy: 'today', assignee: 'me', limit: 10 },
      timeout: 3000,
    }),
    backendClient.get('/api/v1/analytics/dashboard-stats', {
      headers,
      timeout: 3000,
    }),
    backendClient.get('/api/v1/gis/map-preview', {
      headers,
      params: { bbox: session.tenantDefaultBbox },
      timeout: 3000,
    }),
  ]);

  const degraded: string[] = [];

  const result: DashboardDto = {
    incidents: incidents.status === 'fulfilled'
      ? incidents.value.data.data
      : (degraded.push('incidents'), []),
    tasks: tasks.status === 'fulfilled'
      ? tasks.value.data.data
      : (degraded.push('tasks'), []),
    stats: stats.status === 'fulfilled'
      ? stats.value.data.data
      : (degraded.push('stats'), DEFAULT_STATS),
    mapPreview: mapPreview.status === 'fulfilled'
      ? mapPreview.value.data.data
      : (degraded.push('mapPreview'), EMPTY_MAP_PREVIEW),
    _meta: { requestId, degraded },
  };

  // Cache for 10s (only if no sections degraded)
  if (degraded.length === 0) {
    await redisCache.set(cacheKey, JSON.stringify(result), 'EX', 10);
  }

  return NextResponse.json(result);
}

const DEFAULT_STATS: DashboardStats = {
  activeIncidents: 0,
  openTasks: 0,
  pendingApprovals: 0,
  onlineOperators: 0,
  _fallback: true,
};

const EMPTY_MAP_PREVIEW: MapPreviewDto = {
  features: [],
  layers: [],
  _fallback: true,
};
```

### 6.4 Graceful Degradation

The BFF never returns a 500 because one backend call failed. Instead:

1. Each backend call has a 3-second timeout.
2. `Promise.allSettled` ensures all calls complete (or fail) independently.
3. Failed sections are replaced with sensible defaults (empty arrays, zero counts).
4. The `_meta.degraded` array tells the client which sections are degraded.
5. The client renders degraded sections with a subtle banner: "Unable to load [section]. Retrying..."
6. The client retries degraded sections individually via a secondary fetch.

### 6.5 Server Components Integration

Next.js Server Components use the same BFF logic at render time:

```typescript
// apps/web/src/app/(dashboard)/page.tsx
import { backendFetch } from '@/lib/server-fetch';

export default async function DashboardPage() {
  const dashboard = await backendFetch<DashboardDto>('/bff/dashboard', {
    next: { revalidate: 10 }, // ISR: revalidate every 10s
  });

  return (
    <div className="grid grid-cols-12 gap-4">
      <IncidentPanel incidents={dashboard.incidents} degraded={dashboard._meta.degraded.includes('incidents')} />
      <TaskPanel tasks={dashboard.tasks} degraded={dashboard._meta.degraded.includes('tasks')} />
      <StatsPanel stats={dashboard.stats} degraded={dashboard._meta.degraded.includes('stats')} />
      <MapPreview preview={dashboard.mapPreview} degraded={dashboard._meta.degraded.includes('mapPreview')} />
    </div>
  );
}
```

---

## 7. Search Indexing Flow

### 7.1 Architecture

```
Domain Events (NATS JetStream)
        │
        │  consumer: search-indexer
        │  (one per stream, all streams)
        ▼
┌─────────────────────────────┐
│   Search Indexer Service     │
│                             │
│  1. Map event → document    │
│  2. Buffer (batch of 50 or  │
│     every 1s, whichever     │
│     comes first)            │
│  3. _bulk API to OpenSearch │
│  4. ACK NATS messages       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│       OpenSearch Cluster     │
│                             │
│  3 data nodes, 1 ingest     │
│  Hot-warm-delete ILM        │
└─────────────────────────────┘
```

### 7.2 Indexes

| Index | Source Events | Key Fields | Primary Use |
|---|---|---|---|
| `sentinel-incidents` | `incident.created.v1`, `incident.updated.v1`, `incident.severity_changed.v1`, `incident.closed.v1` | `code`, `title`, `description`, `category`, `severity`, `status`, `commander_name`, `tenant_id`, `location` (geo_point), `created_at`, `closed_at` | Incident search, Cmd-K universal search, map search |
| `sentinel-tasks` | `task.created.v1`, `task.updated.v1`, `task.completed.v1`, `task.sla_breached.v1` | `title`, `description`, `assignee_name`, `incident_code`, `status`, `priority`, `sla_breach_at`, `tenant_id` | Task search, assignment lookup |
| `sentinel-documents` | `document.created.v1`, `document.published.v1`, `document.approved.v1` | `title`, `template_code`, `state`, `owner_name`, `incident_code`, `tenant_id`, `published_at` | Document search, approval tracking |
| `sentinel-messages` | `chat.message.posted.v1` | `body`, `author_name`, `channel_name`, `channel_kind`, `incident_code`, `tenant_id`, `posted_at` | Message search within channels and globally |
| `sentinel-users` | `iam.user.created.v1`, `iam.user.updated.v1`, `iam.user.deactivated.v1` | `full_name`, `email`, `roles`, `department`, `tenant_id`, `status` | People search, mention autocomplete |
| `sentinel-audit` | All audit events | `action`, `resource_type`, `resource_id`, `actor_name`, `actor_ip`, `tenant_id`, `reason`, `occurred_at` | Audit log search, compliance investigations |

### 7.3 Index Mapping Example

```json
{
  "sentinel-incidents": {
    "mappings": {
      "dynamic": "strict",
      "properties": {
        "id":              { "type": "keyword" },
        "code":            { "type": "keyword" },
        "title":           { "type": "text", "analyzer": "standard", "fields": { "keyword": { "type": "keyword" } } },
        "description":     { "type": "text", "analyzer": "standard" },
        "category":        { "type": "keyword" },
        "severity":        { "type": "keyword" },
        "status":          { "type": "keyword" },
        "commander_id":    { "type": "keyword" },
        "commander_name":  { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
        "tenant_id":       { "type": "keyword" },
        "location":        { "type": "geo_point" },
        "created_at":      { "type": "date" },
        "closed_at":       { "type": "date" },
        "updated_at":      { "type": "date" }
      }
    },
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "refresh_interval": "1s",
      "analysis": {
        "analyzer": {
          "standard": {
            "type": "standard",
            "stopwords": "_none_"
          }
        }
      }
    }
  }
}
```

### 7.4 Search Indexer Implementation

```typescript
// apps/api/src/modules/search/consumers/search-indexer.service.ts
@Injectable()
export class SearchIndexerService {
  private buffer: BulkOperation[] = [];
  private flushTimer: NodeJS.Timeout;

  constructor(
    private readonly opensearch: OpenSearchClient,
    private readonly logger: Logger,
  ) {
    // Flush every 1s regardless of buffer size
    this.flushTimer = setInterval(() => this.flush(), 1000);
  }

  @NatsConsumer('search-indexer', 'sentinel.>')
  @IdempotentConsumer()
  async handleEvent(event: DomainEvent): Promise<void> {
    const mapping = EVENT_TO_INDEX_MAP[event.type];
    if (!mapping) return; // event type not indexed

    const document = mapping.transform(event);
    const operation: BulkOperation = {
      index: mapping.index,
      id: event.subject.id,
      document,
    };

    this.buffer.push(operation);

    // Flush if buffer reaches 50
    if (this.buffer.length >= 50) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);

    const body = batch.flatMap((op) => [
      { index: { _index: op.index, _id: op.id } },
      op.document,
    ]);

    try {
      const response = await this.opensearch.bulk({ body });

      if (response.body.errors) {
        const failed = response.body.items.filter(
          (item: any) => item.index?.error,
        );
        this.logger.error(
          `Bulk index: ${failed.length}/${batch.length} failed`,
          failed.map((f: any) => f.index.error),
        );
      }
    } catch (err) {
      this.logger.error(`Bulk index failed entirely: ${err.message}`);
      // Re-add to buffer for retry on next cycle
      this.buffer.unshift(...batch);
    }
  }
}
```

### 7.5 Graceful Degradation

When OpenSearch is unavailable:

```
1. Search indexer consumer cannot flush to OpenSearch
   → Bulk API calls fail
   → Events remain unACKed in NATS JetStream
   → NATS holds them in the durable consumer (not lost)
   → Consumer retries with exponential backoff (1s, 2s, 4s, ..., 30s max)

2. Cmd-K search endpoint detects OpenSearch is down
   → Circuit breaker trips after 3 consecutive failures (5s window)
   → Fallback: query PostgreSQL using pg_trgm indexes

   SQL fallback:
   SELECT id, code, title, similarity(title, $1) AS rank
   FROM incident.incidents
   WHERE title % $1 OR code ILIKE $2
   ORDER BY rank DESC
   LIMIT 20;

3. Frontend receives { _meta: { searchEngine: "postgres_fallback" } }
   → Displays banner: "Search may be slower than usual"
   → Results may be less comprehensive (no full-text on descriptions)

4. When OpenSearch recovers:
   → Circuit breaker resets (half-open after 30s)
   → NATS consumer replays backlog
   → Typical backlog replay: ~5000 events/min
   → Full catch-up within minutes for normal traffic
```

### 7.6 Index Lifecycle Management

```json
{
  "policy": {
    "description": "Sentinel index lifecycle",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [
          { "rollover": { "min_index_age": "30d", "min_size": "50gb" } }
        ],
        "transitions": [
          { "state_name": "warm", "conditions": { "min_index_age": "30d" } }
        ]
      },
      {
        "name": "warm",
        "actions": [
          { "replica_count": { "number_of_replicas": 0 } },
          { "force_merge": { "max_num_segments": 1 } }
        ],
        "transitions": [
          { "state_name": "delete", "conditions": { "min_index_age": "365d" } }
        ]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }]
      }
    ]
  }
}
```

Exception: `sentinel-audit` index uses a different policy with 7-year retention (regulatory requirement).

### 7.7 Reindex Capability

Admin endpoint for full reindex when mapping changes or data corruption occurs:

```
POST /admin/search/reindex
{
  "index": "sentinel-incidents",
  "source": "database"   // reads from PostgreSQL, not NATS replay
}
```

This triggers a background job that:
1. Creates a new index (`sentinel-incidents-v2`) with updated mappings.
2. Streams all rows from `incident.incidents` via cursor-based pagination.
3. Bulk indexes into the new index.
4. Swaps the alias `sentinel-incidents` from the old index to the new one.
5. Deletes the old index after 24h.

---

## 8. File Processing Pipeline

### 8.1 Upload Flow

```
Client                  API (File Module)           MinIO              NATS / Workers
  │                          │                        │                      │
  │  POST /files             │                        │                      │
  │  multipart/form-data     │                        │                      │
  │  (or request presigned)  │                        │                      │
  │ ────────────────────►    │                        │                      │
  │                          │                        │                      │
  │                          │  1. Validate:          │                      │
  │                          │     - size < 100MB     │                      │
  │                          │     - type in allowlist│                      │
  │                          │     - magic bytes check│                      │
  │                          │                        │                      │
  │                          │  2. Upload to MinIO    │                      │
  │                          │     bucket: pending    │                      │
  │                          │     key: {tenant}/{id} │                      │
  │                          │ ─────────────────────► │                      │
  │                          │                        │                      │
  │                          │  3. DB Transaction:    │                      │
  │                          │     INSERT file.files  │                      │
  │                          │     (scan_status =     │                      │
  │                          │      'pending')        │                      │
  │                          │     INSERT file.outbox │                      │
  │                          │     (file.uploaded.v1) │                      │
  │                          │     COMMIT             │                      │
  │                          │                        │                      │
  │  201 { fileId,           │                        │                      │
  │    status: 'pending' }   │                        │                      │
  │ ◄────────────────────    │                        │                      │
  │                          │                        │                      │
  │                          │           [Outbox Relay polls]                │
  │                          │                        │    file.uploaded.v1   │
  │                          │                        │ ─────────────────►   │
  │                          │                        │                      │
  │                          │                        │    AV Scanner Worker │
  │                          │                        │ ◄───── download ──── │
  │                          │                        │                      │
  │                          │                        │    ClamAV scan       │
  │                          │                        │    ──────────────    │
  │                          │                        │                      │
  │                          │                        │    file.scanned.v1   │
  │                          │                        │    { status: clean } │
  │                          │                        │ ◄────────────────    │
  │                          │                        │                      │
  │                          │  4. Update file.files  │                      │
  │                          │     scan_status='clean' │                      │
  │                          │                        │                      │
  │                          │  5. Move object:       │                      │
  │                          │     pending → active   │                      │
  │                          │ ─────────────────────► │                      │
  │                          │                        │                      │
  │                          │                        │    Variant Worker    │
  │                          │                        │ ◄── generate ──────  │
  │                          │                        │                      │
  │                          │                        │    - thumbnail sm    │
  │                          │                        │    - thumbnail md    │
  │                          │                        │    - thumbnail lg    │
  │                          │                        │    - OCR text        │
  │                          │                        │    - preview PDF     │
  │                          │                        │                      │
  │                          │  6. INSERT file.variants│                     │
  │                          │     for each variant    │                     │
  │                          │                        │                      │
  │  WebSocket:              │                        │                      │
  │  { type: "file.ready",   │                        │                      │
  │    fileId, variants }    │                        │                      │
  │ ◄────────────────────────│────────────────────────│──────────────────    │
```

### 8.2 File Validation Rules

```typescript
// apps/api/src/modules/file/validation/file-rules.ts
export const FILE_RULES = {
  maxSize: 100 * 1024 * 1024, // 100 MB
  allowedMimeTypes: [
    // Images
    'image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/svg+xml',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Geospatial
    'application/geo+json', 'application/gml+xml',
    'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz',
    // Archives
    'application/zip',
    // Audio/Video (for call recordings)
    'audio/webm', 'video/webm', 'audio/ogg', 'video/mp4',
  ],
  // Magic bytes validation (defense against extension spoofing)
  magicBytes: {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png':  [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'application/zip': [0x50, 0x4B, 0x03, 0x04],
  },
} as const;
```

### 8.3 Download Flow

```typescript
// apps/api/src/modules/file/controllers/file.controller.ts
@Get(':id/download')
@Permission('file.download')
async download(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: AuthenticatedUser,
  @Query('variant') variant?: string,
): Promise<any> {
  const file = await this.fileService.findById(id, user.tenantId);

  if (!file) {
    throw new NotFoundException('FILE_NOT_FOUND');
  }

  switch (file.scanStatus) {
    case 'pending':
      // File is still being scanned
      throw new HttpException(
        { error: 'FILE_SCANNING', message: 'File is being scanned for malware' },
        HttpStatus.ACCEPTED, // 202
      );

    case 'infected':
      // File failed AV scan
      throw new ForbiddenException({
        error: 'FILE_INFECTED',
        message: 'File was flagged as malware and cannot be downloaded',
        signature: file.avSignature,
      });

    case 'scan_failed':
      // AV scan encountered an error -- block download
      throw new HttpException(
        { error: 'FILE_SCAN_FAILED', message: 'File scan did not complete. Contact admin.' },
        HttpStatus.SERVICE_UNAVAILABLE, // 503
      );

    case 'clean':
      break;
  }

  // Determine which object to serve
  const objectKey = variant
    ? file.variants.find((v) => v.kind === variant)?.objectKey
    : file.objectKey;

  if (!objectKey) {
    throw new NotFoundException('VARIANT_NOT_FOUND');
  }

  // Generate presigned URL (15-minute TTL)
  const presignedUrl = await this.minioService.presignGetObject(
    'active', // bucket
    objectKey,
    15 * 60, // 900 seconds
  );

  // Return URL (client redirects) or redirect directly
  return { url: presignedUrl, expiresIn: 900 };
}
```

### 8.4 Presigned Upload (Large Files)

For files >10MB, clients use presigned upload to avoid routing through the API:

```
1. Client: POST /files/presign { filename, mimeType, size }
2. API: validates rules, creates file.files record (scan_status='pending')
3. API: generates presigned PUT URL for MinIO pending bucket (15min TTL)
4. API: returns { fileId, uploadUrl, fields }
5. Client: PUT directly to MinIO (uploadUrl) with file body
6. MinIO: triggers bucket notification → NATS: file.upload_completed
7. File Module: receives notification, writes file.outbox (file.uploaded.v1)
8. Normal scan flow proceeds
```

### 8.5 Timing

| Stage | Duration | Notes |
|-------|----------|-------|
| Upload to API (100MB file) | <10s | Limited by client bandwidth. Presigned bypasses API. |
| Upload to scan start | <5s | Outbox relay (100ms) + NATS delivery (<10ms) + worker pickup. |
| AV scan | <30s | ClamAV for files <100MB. Scales linearly with file size. |
| Scan result to file available | <1s | Move object between buckets + DB update. |
| Variant generation (images) | <60s | Thumbnail generation (sharp), 3 sizes. |
| Variant generation (PDFs) | <120s | PDF preview + OCR (Tesseract). |
| **Total: upload to accessible** | **<2 min p95** | For typical files (images, PDFs <50MB). |

### 8.6 Infected File Handling

When a file is flagged as infected:

```
1. file.scanned.v1 { status: 'infected', signature: 'Win.Trojan.Agent-123' }
2. File Module:
   a. UPDATE file.files SET scan_status = 'infected', av_signature = '...'
   b. DO NOT move to active bucket (stays in pending, will be garbage collected)
   c. Write to outbox: file.quarantined.v1
3. Consumers:
   a. Realtime: notify uploader "File [name] failed malware scan"
   b. Notification: push to uploader + tenant security admin
   c. Audit: write audit event with signature details
   d. References cleanup:
      - If file was attached to a chat message: mark message attachment as quarantined
      - If file was referenced in a sitrep: remove file reference, add system note
4. Garbage collection: CRON deletes infected files from pending bucket after 7 days
   (retained for forensic analysis)
```

---

## 9. Cross-Module Data Flow Scenarios

These scenarios trace data through the full system to illustrate how the patterns from sections 2-8 combine in real operations.

### 9.1 Scenario: Earthquake Incident (Full Lifecycle)

```
════════════════════════════════════════════════════════════════════════════
 PHASE 1: DETECTION + CREATION
════════════════════════════════════════════════════════════════════════════

1. Seismic feed integration receives USGS ShakeAlert data
   External webhook → POST /api/v1/incidents
   {
     "title": "M6.2 Earthquake - Dushanbe Region",
     "category": "EARTHQUAKE",
     "severity": "CRITICAL",
     "location": { "type": "Point", "coordinates": [68.7870, 38.5598] },
     "source": "seismic_feed",
     "metadata": { "magnitude": 6.2, "depth_km": 12, "mmi": "VII" }
   }

   Request-Response flow (Section 2):
   → Edge → BFF → Gateway → AuthGuard (api_key actor) → IncidentController
   → IncidentService.create()
   → DB Transaction:
       INSERT incident.incidents (status=REPORTED, severity=CRITICAL)
       INSERT incident.timeline (kind=CREATED, auto_source=seismic_feed)
       INSERT incident.outbox (incident.created.v1)
       COMMIT
   → 201 { data: { id: "01HX...", code: "EQ-2026-0412-001", ... } }

2. incident.created.v1 propagates (Section 3):

   a. Chat (chat-room-creator consumer):
      INSERT chat.channels (kind=INCIDENT_ROOM, name="EQ-2026-0412-001")
      INSERT chat.members (user_id = system, role = bot)
      INSERT chat.outbox → chat.channel.created.v1

   b. Notification (notification-incident consumer):
      severity=CRITICAL → BROADCAST mode
      → Push notification to ALL on-duty operators
      → SMS to all shift leads and duty officers
      → Siren activation API call (if configured)
      INSERT notification.notifications (×N, one per recipient)

   c. GIS (gis-incident consumer):
      INSERT gis.layers (incident_id, kind=INCIDENT_LAYER)
      INSERT gis.features (type=Point, geometry=epicenter, properties=earthquake_data)
      INSERT gis.outbox → gis.feature.created.v1

   d. Analytics (analytics-etl consumer):
      INSERT analytics.fact_incident (id, tenant_id, category=EARTHQUAKE,
        severity=CRITICAL, status=REPORTED, created_at)
      UPSERT analytics.dim_category (EARTHQUAKE)

   e. Audit (audit-writer consumer):
      INSERT audit.events (type=incident.created.v1, actor=api_key,
        subject=incident:01HX..., hash=HMAC(...))

   f. Realtime (realtime-fanout consumer):
      → Socket.IO emit to room "tenant:{tenantId}"
        { type: "incident.created", scope: "tenant:...",
          data: { code: "EQ-2026-0412-001", severity: "CRITICAL", ... } }
      → All operator dashboards update immediately

   g. Search (search-indexer consumer):
      UPSERT sentinel-incidents { code, title, severity=CRITICAL, category=EARTHQUAKE, ... }

════════════════════════════════════════════════════════════════════════════
 PHASE 2: COMMAND ASSIGNMENT
════════════════════════════════════════════════════════════════════════════

3. Shift Lead assigns Incident Commander:
   POST /api/v1/incidents/01HX.../commander
   { "userId": "f47ac10b..." }

   → IncidentService.assignCommander()
   → DB Transaction:
       UPDATE incident.incidents SET commander_id = 'f47ac10b...',
         status = 'ACTIVE'
       INSERT incident.timeline (kind=COMMANDER_ASSIGNED)
       INSERT incident.outbox (incident.commander_assigned.v1)
       COMMIT

4. incident.commander_assigned.v1 propagates:

   a. Notification → push to new IC: "You are now IC for EQ-2026-0412-001"
   b. Chat → INSERT chat.members (channel=INCIDENT_ROOM, user=IC, role=admin)
   c. Realtime → incident scope + tenant scope update
   d. Audit → write

════════════════════════════════════════════════════════════════════════════
 PHASE 3: TASK MOBILIZATION
════════════════════════════════════════════════════════════════════════════

5. IC creates tasks from earthquake response template:
   POST /api/v1/tasks/bulk
   {
     "incidentId": "01HX...",
     "templateId": "earthquake_response_v3",
     "overrides": [
       { "templateTaskCode": "SEARCH_RESCUE", "assigneeId": "..." },
       { "templateTaskCode": "MEDICAL_TRIAGE", "assigneeId": "..." },
       { "templateTaskCode": "EVAC_ZONE", "assigneeId": "..." },
       ...
     ]
   }

   → TaskService.createFromTemplate()
   → DB Transaction:
       INSERT task.tasks (×12 tasks from template, each with SLA)
       INSERT task.outbox (task.created.v1 × 12)
       COMMIT

6. task.created.v1 (×12) propagate:

   a. Notification → push to each assignee: "New task: [title] for EQ-2026-0412-001"
      (12 notifications, batched into single NATS publish per assignee)
   b. Realtime → task board updates for all incident subscribers
   c. Analytics → UPDATE analytics.fact_incident SET task_count = 12
   d. Audit → 12 audit events

════════════════════════════════════════════════════════════════════════════
 PHASE 4: FIELD OPERATIONS
════════════════════════════════════════════════════════════════════════════

7. Field responder submits situation report with photo:
   POST /api/v1/incidents/01HX.../sitreps
   {
     "summary": "Eastern sector: 3 buildings collapsed, road blocked at km 47",
     "location": { "type": "Point", "coordinates": [68.82, 38.55] },
     "casualties": { "confirmed": 12, "estimated": 40 },
     "fileIds": ["file-01HX..."]   ← previously uploaded
   }

   POST /files (photo upload, already completed)
   → File pipeline: upload → AV scan → clean → variants (thumbnails)

8. incident.sitrep.submitted.v1 propagates:

   a. GIS → INSERT gis.features (type=Point, geometry=sitrep_location,
      properties={casualties, summary})
      → Map updates for all subscribers in incident scope

   b. Timeline → INSERT incident.timeline (kind=SITREP_SUBMITTED,
      data={summary, location, casualties, fileIds})

   c. Realtime → push to incident scope:
      - Timeline component updates with new sitrep
      - Map component plots new sitrep marker
      - Casualties count updates on incident header

   d. Notification → push to IC: "New sitrep from [responder]"

   e. Analytics → UPDATE analytics.fact_incident
      SET sitrep_count = sitrep_count + 1,
          casualty_confirmed = 12, casualty_estimated = 40

════════════════════════════════════════════════════════════════════════════
 PHASE 5: CLOSURE
════════════════════════════════════════════════════════════════════════════

9. IC closes incident:
   POST /api/v1/incidents/01HX.../transitions
   { "transition": "close", "reason": "All operations complete. Recovery phase begins." }

   → IncidentService.transition()
   → State machine check: ACTIVE → CLOSED (valid)
   → Pre-condition check: all tasks in DONE or CANCELLED state
   → DB Transaction:
       UPDATE incident.incidents SET status = 'CLOSED', closed_at = now()
       INSERT incident.timeline (kind=STATUS_CHANGE, data={from:ACTIVE, to:CLOSED})
       INSERT incident.outbox (incident.closed.v1)
       COMMIT

10. incident.closed.v1 propagates:

    a. Chat → UPDATE chat.channels SET archived_at = now()
       WHERE incident_id = '01HX...'
       (channel becomes read-only)

    b. Document → Auto-generate post-incident report:
       INSERT document.documents (template=POST_INCIDENT_REPORT,
         incident_id='01HX...', state=DRAFT)
       Pre-fill with: timeline entries, sitreps, task summary, casualties
       INSERT document.outbox → document.created.v1

    c. Analytics → UPDATE analytics.fact_incident
       SET closed_at = now(), duration_hours = EXTRACT(...)

    d. Notification → push to ALL incident participants:
       "Incident EQ-2026-0412-001 has been closed"

    e. Audit → write (actor=IC, action=incident.closed, reason=...)

    f. Realtime → incident scope + tenant scope:
       Dashboard removes from active list, moves to recent
```

### 9.2 Scenario: Task SLA Breach

```
════════════════════════════════════════════════════════════════════════════
 SCHEDULED CHECK + CASCADE
════════════════════════════════════════════════════════════════════════════

1. Scheduled job (every 60s):
   TaskSlaService.checkBreaches()

   SQL:
   SELECT id, incident_id, assignee_id, title, priority, sla_breach_at
   FROM task.tasks
   WHERE status NOT IN ('DONE', 'CANCELLED')
     AND sla_breach_at < now()
     AND sla_breached = false;

2. For each breached task (within transaction):
   UPDATE task.tasks SET sla_breached = true WHERE id = $1;
   INSERT task.outbox (task.sla_breached.v1)
     payload: { taskId, incidentId, assigneeId, title, priority,
                slaBreachAt, overdueBy }

3. task.sla_breached.v1 propagates:

   a. Notification:
      - Push to assignee: "Task [title] is overdue"
      - Push to IC (incident commander): "Task [title] assigned to [name] is overdue"
      - If priority >= HIGH:
        SMS to assignee + IC
      - If priority = CRITICAL:
        SMS to shift lead + tenant admin

   b. Realtime → push to incident scope:
      { type: "task.sla_breached",
        data: { taskId, title, overdueBy: "2h 15m" } }
      → Task board: SLA badge turns red
      → Incident timeline: auto-entry "Task [title] SLA breached"

   c. Analytics:
      UPDATE analytics.fact_task_sla
      SET breached = true, breach_duration = now() - sla_breach_at
      WHERE task_id = $1;

   d. Audit:
      INSERT audit.events (type=task.sla_breached.v1, actor=system,
        subject=task:{taskId})
```

### 9.3 Scenario: Document Approval Chain

```
════════════════════════════════════════════════════════════════════════════
 MULTI-STEP APPROVAL WORKFLOW
════════════════════════════════════════════════════════════════════════════

1. Author submits document for review:
   POST /api/v1/documents/01HX.../submit
   { "note": "Updated casualty figures in section 3" }

   → DocumentService.submit()
   → State machine: DRAFT → IN_REVIEW (valid)
   → Load approval policy from template:
     { requiredApprovers: ["role:shift_lead", "role:ic"], quorum: 2 }
   → DB Transaction:
       UPDATE document.documents SET state = 'IN_REVIEW'
       INSERT document.approvals (×2 pending approval records)
       INSERT document.timeline (kind=SUBMITTED)
       INSERT document.outbox (document.review_requested.v1)
       COMMIT

2. document.review_requested.v1 propagates:

   a. Notification → push to all required approvers:
      "Document [title] requires your review"
      → Shows in approval inbox on dashboard

   b. Audit → write (actor=author, action=document.submitted)

   c. Realtime → push to user scope for each approver:
      { type: "document.review_requested",
        data: { documentId, title, authorName, note } }
      → Approval badge count increments

3. Approver 1 (Shift Lead) approves:
   POST /api/v1/documents/01HX.../approve
   { "note": "Figures verified against field reports" }

   → DocumentService.approve()
   → DB Transaction:
       UPDATE document.approvals SET decision='APPROVED',
         decided_at=now(), note='...'
         WHERE document_id=$1 AND approver_id=$2
       Check quorum: 1/2 met → state stays IN_REVIEW
       INSERT document.timeline (kind=APPROVED_PARTIAL)
       INSERT document.outbox (document.approved.v1 with quorumMet=false)
       COMMIT

4. document.approved.v1 (quorumMet=false) propagates:

   a. Notification → push to author:
      "[Shift Lead name] approved your document (1/2 approvals)"

   b. Realtime → push to document subscribers:
      { type: "document.approval_progress",
        data: { approved: 1, required: 2, latestApprover: "..." } }

5. Approver 2 (IC) approves (quorum now met):
   POST /api/v1/documents/01HX.../approve
   { "note": "Approved for distribution" }

   → DocumentService.approve()
   → DB Transaction:
       UPDATE document.approvals SET decision='APPROVED', ...
       Check quorum: 2/2 met → state transitions to APPROVED
       UPDATE document.documents SET state = 'APPROVED'
       INSERT document.timeline (kind=APPROVED_FULL)
       INSERT document.outbox (document.approved.v1 with quorumMet=true)
       -- If template has auto_publish=true:
       UPDATE document.documents SET state = 'PUBLISHED', published_at=now()
       INSERT document.outbox (document.published.v1)
       COMMIT

6. document.approved.v1 (quorumMet=true) propagates:

   a. Notification → push to author:
      "Your document has been fully approved"

7. (If not auto-publish) Author signs:
   POST /api/v1/documents/01HX.../sign
   { "credential": { "type": "webauthn", "assertion": "..." } }

   → DocumentService.sign()
   → Verify WebAuthn assertion against user's registered credential
   → DB Transaction:
       INSERT document.signatures (user_id, credential_id, signature_data,
         document_hash=SHA256(content))
       INSERT document.timeline (kind=SIGNED)
       INSERT document.outbox (document.signed.v1)
       COMMIT

8. document.signed.v1 propagates:

   a. Audit → write (includes signature data, credential ID, document hash)

9. Author publishes:
   POST /api/v1/documents/01HX.../publish

   → DocumentService.publish()
   → State machine: APPROVED → PUBLISHED (valid, requires signature)
   → DB Transaction:
       UPDATE document.documents SET state = 'PUBLISHED', published_at = now()
       INSERT document.timeline (kind=PUBLISHED)
       INSERT document.outbox (document.published.v1)
       COMMIT

10. document.published.v1 propagates:

    a. Realtime → push to tenant scope (if incident-linked):
       { type: "document.published",
         data: { documentId, title, incidentCode, publishedAt } }
       → Document list updates for all users with access

    b. Notification → push to incident participants (if incident-linked):
       "Situation Report #3 for EQ-2026-0412-001 has been published"

    c. Analytics:
       UPDATE analytics.fact_incident SET document_count = document_count + 1

    d. Timeline (if incident-linked):
       INSERT incident.timeline (kind=DOCUMENT_PUBLISHED,
         data={documentId, title, type})

    e. Search → UPSERT sentinel-documents { state: "PUBLISHED", published_at }

    f. Audit → write
```

---

## 10. Data Consistency Model

### 10.1 Consistency Boundaries

| Boundary | Consistency Level | Mechanism | SLA |
|----------|-------------------|-----------|-----|
| Within a module (same DB transaction) | **Strong (ACID)** | PostgreSQL transaction with SERIALIZABLE or READ COMMITTED isolation | Immediate |
| Cross-module (event-driven) | **Eventual** | Transactional outbox + NATS JetStream + idempotent consumers | p95 < 1s |
| Read-after-write (same user, same module) | **Causal** | Synchronous REST returns the latest state; events catch up independently | Immediate for writer |
| Realtime delivery | **Best-effort with guaranteed resync** | WebSocket + Redis Stream buffer + REST fallback protocol | p95 < 500ms, recovery < 5s |
| Analytics materialization | **Eventual** | NATS consumer + batch insert into fact/dimension tables | p95 < 30s |
| Search index | **Eventual** | NATS consumer + OpenSearch bulk API (batched every 1s or 50 events) | p95 < 5s |
| Audit log | **Eventual** | NATS consumer + PostgreSQL batch insert | p95 < 2s |
| File processing | **Eventual** | NATS consumer + ClamAV + MinIO + variant workers | p95 < 2 min |

### 10.2 Known Eventual Consistency Windows

These are specific cases where a user might observe stale data. Each is documented with its expected duration, impact, and mitigation.

| Scenario | Stale Window | Impact | Mitigation |
|----------|-------------|--------|------------|
| After creating incident, dashboard does not show it | < 1s | Low. The creator already has the response with the new incident. | Creator's UI optimistically adds the incident to the list immediately from the POST response. Other users see it within 1s via WebSocket. |
| After closing incident, task board still shows "open" tasks | < 500ms | Negligible. Close pre-checks that all tasks are done. | Realtime event updates task board within 500ms. Task status is authoritative from the task module's perspective. |
| After sending a chat message, other users don't see it immediately | < 500ms | Low for non-critical comms. | WebSocket delivery is typically <200ms. Messages are ordered by server timestamp, not arrival time. |
| After file upload, file shows "scanning" status | 5-30s | Expected UX. Users understand AV scanning takes time. | UI shows progress indicator with estimated time. Push notification when scan completes. |
| After role/permission change, old permissions may be served | Up to 30s | Medium for security-critical changes. | PDP cache TTL is 30s. For immediate effect (e.g., emergency revocation), admin can call `POST /admin/iam/cache/invalidate` to flush PDP cache. Break-glass deactivation bypasses cache entirely. |
| After incident severity upgrade, analytics dashboard shows old severity | < 30s | Low. Analytics is for trend analysis, not operational decisions. | Dashboard shows "last updated" timestamp. Manual refresh available. |
| After OpenSearch goes down, search results may be stale | Duration of outage + replay time | Medium. Cmd-K search degrades to PostgreSQL fallback. | Banner shown: "Search may be slower than usual." NATS holds events for replay on recovery. |

### 10.3 Compensating Actions

When eventual consistency creates a real problem, the system uses compensating mechanisms:

#### Race: Incident Closed but Task Created Simultaneously

```
Timeline:
  t=0:    IC clicks "Close Incident"
  t=50ms: Responder submits new task for same incident
  t=100ms: Close transaction commits (status=CLOSED)
  t=150ms: Task creation transaction starts

Resolution:
  TaskService.create() checks incident status within its own transaction:
    SELECT status FROM incident.incidents WHERE id = $1 FOR SHARE;
    if (status === 'CLOSED') throw new ConflictException('INCIDENT_CLOSED');

  The task creation is rejected. The responder sees:
    409 { error: 'INCIDENT_CLOSED', message: 'Cannot create tasks for a closed incident' }

  This works because both operations read from the same PostgreSQL database.
  Cross-module does NOT mean cross-database in a modular monolith.
```

#### Race: Notification Sent for Cancelled Event

```
Scenario:
  IC assigns commander → notification sent → IC immediately un-assigns

Resolution:
  The "un-assign" event triggers a compensating notification:
    notification.notifications: UPDATE SET cancelled_at = now()
    WHERE event_type = 'incident.commander_assigned.v1'
      AND subject_id = $incidentId
      AND read_at IS NULL;

  Client UI:
    - Unread notification shows strikethrough with "[Outdated]" badge
    - Push notification (if already delivered) followed by silent update
    - SMS cannot be recalled -- this is documented as an accepted trade-off
```

#### Drift: Analytics Fact Diverges from Source

```
Detection:
  Nightly reconciliation job (02:00 local time):

  -- Compare incident counts
  SELECT
    (SELECT count(*) FROM incident.incidents WHERE tenant_id = $1) AS source,
    (SELECT count(*) FROM analytics.fact_incident WHERE tenant_id = $1) AS fact;

  -- If drift > 1%:
  INSERT INTO analytics.reconciliation_log (tenant_id, entity, source_count,
    fact_count, drift_pct, detected_at);

  -- Alert operations team
  emit metric: analytics.drift.incidents{tenant=$1} = drift_pct

Resolution:
  - If drift < 1%: auto-heal by replaying events for missing IDs
  - If drift > 1%: alert to operations team for investigation
  - Admin can trigger full recompute:
    POST /admin/analytics/recompute { entity: "incident", tenantId: "..." }
```

#### Partition: NATS Unavailable

```
Scenario: NATS JetStream is unreachable.

Impact:
  - Outbox relay cannot publish events → events accumulate in outbox tables
  - All consumers stall (no new events to process)
  - Realtime delivery stops (no events reach the gateway)
  - Search index becomes stale
  - Notifications are delayed

The system does NOT break:
  - REST API continues to work normally (sync path is unaffected)
  - Outbox tables have no size limit (PostgreSQL handles accumulation)
  - When NATS recovers, outbox relay publishes the backlog in order
  - Consumers replay from their last acknowledged position
  - End-to-end recovery time: backlog size / relay throughput
    (at 1000 events/s relay rate, a 60s outage = 60s to catch up)

Monitoring:
  - Metric: outbox.unpublished_count (alert if > 1000)
  - Metric: nats.consumer.pending (alert if > 5000)
  - Metric: realtime.delivery.lag_ms (alert if p95 > 5000ms)
```

### 10.4 Transaction Isolation Levels

| Operation | Isolation Level | Reason |
|-----------|----------------|--------|
| Standard CRUD (create, update, read) | READ COMMITTED | Default PostgreSQL level. Sufficient for most operations. Phantom reads acceptable. |
| State machine transitions (close, approve) | SERIALIZABLE | Prevents race conditions on status checks. If two transitions conflict, one is retried. |
| Outbox relay (read + mark published) | READ COMMITTED + `FOR UPDATE SKIP LOCKED` | Allows multiple relay instances without blocking. Skipped rows are processed next cycle. |
| Analytics ETL (batch insert) | READ COMMITTED | Analytics are append-only. No conflict possible. |
| Audit write (append-only) | READ COMMITTED | Sequential hash chain enforced by consumer ordering, not DB isolation. |

### 10.5 Ordering Guarantees

| Guarantee | Scope | Mechanism |
|-----------|-------|-----------|
| Events for a single aggregate are ordered | Per aggregate (e.g., per incident) | Outbox relay reads `ORDER BY created_at`. NATS subject partitioning by aggregate ID. |
| Events across aggregates are NOT ordered | Global | By design. No global ordering is needed or enforced. |
| Consumer processes events in order per subject | Per NATS subject | JetStream durable consumer with `max_ack_pending: 1` for ordered subjects. |
| Chat messages are ordered within a channel | Per channel | Message `created_at` set by server. Client sorts by server timestamp, not local time. |
| Audit events are hash-chained | Per tenant | Each audit event's HMAC includes the previous event's hash. Tampering breaks the chain. |

---

*This document is a living artifact. Update it when data flow patterns change. Review quarterly with the Architecture Review Board.*
