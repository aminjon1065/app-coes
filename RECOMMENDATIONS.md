# CoESCD Project — Improvement Recommendations

> Generated: 2026-04-15 | Stack: NestJS + Next.js + PostgreSQL/PostGIS + Redis + NATS + WebRTC

---

## 1. Security Hardening

### 1.1 — Hardcoded JWT Secrets
**Severity: High**

`backend/src/modules/chat/chat.module.ts` defaults to:
```ts
secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-min-32-chars-change-me'
```
- Move **all** JWT secrets to required environment variables only — no fallback defaults for secrets.
- Add `validationDecorator` at bootstrap to fail fast if critical env vars are missing.

### 1.2 — Tenant RLS raw SQL
**Severity: Medium**

`TenantRlsInterceptor` uses raw SQL `SET LOCAL app.tenant_id = $1`. While functional:
- Wrap in a parameterized helper with typed input to prevent injection.
- Consider a tenant context object instead of raw string interpolation.

### 1.3 — Missing rate limits on write operations
**Severity: Medium**

`ThrottlerModule` only defines a `read` throttler. Add corresponding `write` and `auth` throttlers:
- `POST/PUT/PATCH/DELETE` endpoints → `write` limit
- `/auth/*` endpoints → `auth` limit (stricter)

---

## 2. Testing Coverage

### 2.1 — No E2E tests
**Severity: High**

`backend/test/app.e2e-spec.ts` is a placeholder. Priority test areas:
- Auth flow (login → JWT → protected routes)
- Tenant isolation (cross-tenant data access should be blocked)
- Incident lifecycle state transitions
- Task status state machine transitions
- Chat message creation and delivery

### 2.2 — Unit test gaps
**Severity: Medium**

Services with complex business logic (Task state machine, Incident lifecycle, TenantRlsInterceptor) lack unit tests. Add unit tests for:
- `Task` status transition rules
- `Incident` lifecycle state machine
- Permission/Role guards

### 2.3 — Frontend mock data
**Severity: Low**

Fallback mock workspaces in frontend (`chat-workspace.ts`, GIS mocks) are hardcoded. Move to a dedicated test fixtures file or use MSW (Mock Service Worker) for API-level mocking.

---

## 3. Data & Migrations

### 3.1 — No visible migrations directory
**Severity: High**

`TypeORM` is configured with `synchronize: false`, but no `migrations` folder or migration files are visible. Establish a migration workflow:
- Create `backend/src/database/migrations/` with naming convention `YYYYMMDDHHMMSS-description.ts`
- Add a `migration:run` npm script
- Document the process in CONTRIBUTING.md

### 3.2 — Synchronize disabled but no migration scripts
**Severity: High**

Without migrations, schema changes require manual intervention or `synchronize: true` (dangerous in production). Write a migration for the current schema before shipping.

---

## 4. Feature Completeness

### 4.1 — MediaSoup / Call module is incomplete
**Severity: Medium**

The `call` module only has 4 files. WebRTC SFU (mediasoup) requires:
- Proper router/transport creation per room
- ICE candidate handling
- Recording capability (if required)
- Frontend call UI integration end-to-end

Verify the call flow end-to-end and fill in gaps.

### 4.2 — NATS JetStream has no consumers
**Severity: Medium**

`NatsModule` exists but no visible event consumers (handlers for `NATS_STREAM_IAM`, `NATS_STREAM_INCIDENT`, etc.). Either:
- Implement event consumers to make use of the streams, or
- Document that NATS is provisioned for future use to avoid confusion

### 4.3 — Admin panel API stubs
**Severity: Low**

`admin-workspace.ts` is very small — the admin UI components exist but backend API coverage appears incomplete. Audit which admin operations are wired up vs. stubs.

---

## 5. Code Quality

### 5.1 — Git history shows single bulk commit
**Severity: Low (process)**

Only 7 commits, all "0.0.1" — the entire project was likely committed in one bulk operation. For future development:
- Use conventional commits (`feat:`, `fix:`, `chore:`)
- Branch per feature/fix

### 5.2 — No CONTRIBUTING.md
**Severity: Low**

Add a `CONTRIBUTING.md` covering:
- Local dev setup (Docker, env vars)
- Running migrations
- Running tests
- PR conventions

### 5.3 — Redis abstraction missing
**Severity: Low**

`IORedis` is used directly in some modules rather than through a shared `CacheModule` abstraction. Consider:
- A unified `RedisService` in `shared/` that all modules import
- Standardize serialization (JSON by default)

---

## 6. Observability

### 6.1 — Prometheus/Grafana provisioned but not wired
**Severity: Low**

The observability profile exists in Docker Compose but ensure:
- All NestJS services export Prometheus metrics (`/metrics` endpoint)
- Dashboards are imported into Grafana
- Alerts are configured for critical paths (DB connections, NATS, Redis)

---

## Priority Matrix

| Priority | Item | Effort |
|----------|------|--------|
| **P0** | Move JWT secrets to env-only | Low |
| **P0** | Write initial database migrations | Medium |
| **P0** | Add E2E tests for auth + tenant isolation | High |
| **P1** | Complete MediaSoup call module E2E | High |
| **P1** | Add write/auth throttlers | Low |
| **P1** | NATS consumers or documented decision | Medium |
| **P2** | Unit tests for state machines | Medium |
| **P2** | Admin API completeness audit | Medium |
| **P2** | CONTRIBUTING.md | Low |
| **P3** | Redis abstraction | Medium |
| **P3** | Prometheus metric wiring | Low |

---

## Quick Wins (Under 2 Hours)

1. **Remove JWT secret fallback** — Delete the `|| 'dev-access-secret...'` default
2. **Create first migration** — Generate migration for current schema using TypeORM CLI
3. **Add write throttler** — Copy the existing `read` throttler config and name it `write`
4. **Create CONTRIBUTING.md** — Scaffold with local dev setup instructions
5. **Add Prometheus metrics endpoint** — If not already on all services
