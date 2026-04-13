# CoESCD -- Deployment and Operations Architecture

> National Disaster Management Platform  
> NestJS Modular Monolith on Kubernetes  
> Version 1.0 | Last updated 2026-04-12

---

## Table of Contents

1. [Repository Layout](#1-repository-layout)
2. [Local Development](#2-local-development)
3. [Dockerfile Strategy](#3-dockerfile-strategy)
4. [CI/CD Pipeline](#4-cicd-pipeline)
5. [Kubernetes Architecture](#5-kubernetes-architecture)
6. [Storage Classes](#6-storage-classes)
7. [Sovereign / On-Prem Deployment](#7-sovereign--on-prem-deployment)
8. [Resilience Patterns](#8-resilience-patterns)
9. [Disaster Recovery](#9-disaster-recovery)
10. [Scaling Strategy](#10-scaling-strategy)

---

## 1. Repository Layout

The CoESCD platform is organized as a pnpm + Nx monorepo. Every directory has a single, clear responsibility.

```
sentinel/
├── apps/
│   ├── api/                 # NestJS modular monolith -- all 10 bounded contexts
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── iam/            # Identity, authn, authz, tenants, roles
│   │   │   │   ├── incident/       # Incident lifecycle, ITCZ phases
│   │   │   │   ├── task/           # Task assignment, Kanban, checklists
│   │   │   │   ├── geo/            # GIS layers, geofences, spatial queries
│   │   │   │   ├── comms/          # Chat, channels, threads, presence
│   │   │   │   ├── notification/   # Push, SMS, email, in-app alerts
│   │   │   │   ├── resource/       # Inventory, logistics, allocation
│   │   │   │   ├── document/       # File management, versioning, OCR
│   │   │   │   ├── analytics/      # Dashboards, reports, data export
│   │   │   │   └── integration/    # External feeds (weather, seismic, CAP)
│   │   │   ├── shared/
│   │   │   │   ├── database/       # TypeORM/MikroORM setup, base entities
│   │   │   │   ├── auth/           # Guards, decorators, JWT strategy
│   │   │   │   ├── events/         # NATS client wrapper, outbox relay
│   │   │   │   ├── cache/          # Redis cache wrapper
│   │   │   │   ├── search/         # OpenSearch client wrapper
│   │   │   │   └── health/         # /healthz and /readyz controllers
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/
│   │   └── package.json
│   │
│   ├── realtime/            # Realtime gateway (Socket.IO + Redis adapter)
│   │   ├── src/
│   │   │   ├── gateways/         # WebSocket gateways per domain
│   │   │   ├── adapters/         # Redis pub/sub adapter for multi-pod
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   ├── workers/             # Background workers (ETL, notification, doc render, OCR, AV scan)
│   │   ├── src/
│   │   │   ├── processors/       # NATS JetStream consumers per queue
│   │   │   │   ├── etl.processor.ts
│   │   │   │   ├── notification.processor.ts
│   │   │   │   ├── document-render.processor.ts
│   │   │   │   ├── ocr.processor.ts
│   │   │   │   └── av-scan.processor.ts
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   ├── sfu/                 # mediasoup signaling service
│   │   ├── src/
│   │   │   ├── rooms/            # Room management, peer tracking
│   │   │   ├── mediasoup/        # Worker pool, router, transport factory
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── web/                 # Next.js App Router (BFF + frontend)
│       ├── src/
│       │   ├── app/              # Next.js App Router pages
│       │   ├── components/       # Page-specific components
│       │   ├── lib/              # API client, auth helpers, hooks
│       │   └── middleware.ts     # Auth middleware, tenant resolution
│       ├── next.config.mjs
│       └── package.json
│
├── packages/
│   ├── contracts/           # OpenAPI specs + event JSON schemas + shared TypeScript types
│   │   ├── openapi/              # Per-module OpenAPI YAML specs
│   │   ├── events/               # JSON Schema for every NATS event
│   │   ├── types/                # Generated TypeScript types (openapi-typescript)
│   │   └── package.json
│   │
│   ├── ui/                  # Shared shadcn/ui components + Storybook
│   │   ├── src/
│   │   ├── .storybook/
│   │   └── package.json
│   │
│   ├── design-tokens/       # OKLCH color tokens, spacing, typography, dark/light themes
│   │   ├── tokens/
│   │   └── package.json
│   │
│   ├── eslint-config/       # Shared ESLint rules including architectural boundary enforcement
│   │   ├── index.js
│   │   └── package.json
│   │
│   └── tsconfig/            # Shared TypeScript configs
│       ├── base.json
│       ├── nestjs.json
│       ├── nextjs.json
│       └── package.json
│
├── infra/
│   ├── docker/              # Dockerfiles for all apps + docker-compose for dev
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.realtime
│   │   ├── Dockerfile.workers
│   │   ├── Dockerfile.sfu
│   │   ├── Dockerfile.web
│   │   └── docker-compose.yml
│   │
│   ├── k8s/                 # Helm charts (umbrella + subcharts)
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   ├── values-staging.yaml
│   │   ├── values-production.yaml
│   │   ├── values-onprem.yaml
│   │   └── charts/
│   │
│   └── terraform/           # Infrastructure provisioning (optional for cloud)
│       ├── modules/
│       ├── envs/
│       └── main.tf
│
├── tools/
│   ├── seed/                # Database seed scripts
│   │   ├── dev-seed.ts
│   │   └── fixtures/
│   ├── migrations/          # Database migrations (per-schema)
│   │   ├── init.sql          # Creates schemas + extensions
│   │   ├── iam/
│   │   ├── incident/
│   │   ├── task/
│   │   ├── geo/
│   │   ├── comms/
│   │   ├── notification/
│   │   ├── resource/
│   │   ├── document/
│   │   ├── analytics/
│   │   └── integration/
│   └── scripts/             # Dev utility scripts
│       ├── reset-db.sh
│       ├── generate-types.sh
│       └── port-forward.sh
│
├── docs/                    # Architecture docs, module specs, ADRs
│   ├── architecture/
│   ├── modules/
│   └── adrs/
│
├── nx.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── .eslintrc.js
├── .prettierrc
└── turbo.json
```

### Nx Project Graph Boundaries

Nx enforces a strict dependency graph. Every project in `nx.json` carries `tags` that declare its layer and scope:

```json
// nx.json (project configuration excerpt)
{
  "projects": {
    "@sentinel/api":           { "tags": ["scope:api",      "type:app"]     },
    "@sentinel/realtime":      { "tags": ["scope:realtime",  "type:app"]     },
    "@sentinel/workers":       { "tags": ["scope:workers",   "type:app"]     },
    "@sentinel/sfu":           { "tags": ["scope:sfu",       "type:app"]     },
    "@sentinel/web":           { "tags": ["scope:web",       "type:app"]     },
    "@sentinel/contracts":     { "tags": ["scope:shared",    "type:lib"]     },
    "@sentinel/ui":            { "tags": ["scope:frontend",  "type:lib"]     },
    "@sentinel/design-tokens": { "tags": ["scope:frontend",  "type:lib"]     },
    "@sentinel/eslint-config": { "tags": ["scope:tooling",   "type:lib"]     },
    "@sentinel/tsconfig":      { "tags": ["scope:tooling",   "type:lib"]     }
  }
}
```

ESLint enforces these boundaries via `@nx/enforce-module-boundaries`:

```javascript
// packages/eslint-config/index.js
module.exports = {
  plugins: ['@nx'],
  rules: {
    '@nx/enforce-module-boundaries': [
      'error',
      {
        enforceBuildableLibDependency: true,
        allow: [],
        depConstraints: [
          // Apps can import shared libs
          { sourceTag: 'type:app',     onlyDependOnLibsWithTags: ['type:lib'] },

          // Frontend libs cannot import backend libs
          { sourceTag: 'scope:frontend', onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'] },

          // Backend apps can import contracts but not frontend libs
          { sourceTag: 'scope:api',      onlyDependOnLibsWithTags: ['scope:shared', 'scope:tooling'] },
          { sourceTag: 'scope:realtime', onlyDependOnLibsWithTags: ['scope:shared', 'scope:tooling'] },
          { sourceTag: 'scope:workers',  onlyDependOnLibsWithTags: ['scope:shared', 'scope:tooling'] },
          { sourceTag: 'scope:sfu',      onlyDependOnLibsWithTags: ['scope:shared', 'scope:tooling'] },

          // Web can use frontend libs and shared contracts
          { sourceTag: 'scope:web',      onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared', 'scope:tooling'] },

          // Contracts cannot depend on anything except tooling
          { sourceTag: 'scope:shared',   onlyDependOnLibsWithTags: ['scope:tooling'] },

          // Tooling libs are leaf nodes -- no deps on other project libs
          { sourceTag: 'scope:tooling',  onlyDependOnLibsWithTags: [] },
        ],
      },
    ],
  },
};
```

**Dependency rules summarized:**

| Source | Can Import | Cannot Import |
|---|---|---|
| `@sentinel/api` | `contracts`, `tsconfig`, `eslint-config` | `ui`, `design-tokens`, `web` |
| `@sentinel/web` | `ui`, `design-tokens`, `contracts`, `tsconfig` | `api`, `realtime`, `workers`, `sfu` |
| `@sentinel/realtime` | `contracts`, `tsconfig` | `ui`, `web`, `api` (communicates via NATS/Redis) |
| `@sentinel/workers` | `contracts`, `tsconfig` | `ui`, `web`, `api` (communicates via NATS) |
| `@sentinel/sfu` | `contracts`, `tsconfig` | `ui`, `web`, `api` |
| `@sentinel/contracts` | `tsconfig` | Everything else |
| `@sentinel/ui` | `design-tokens`, `contracts` | All apps |

Within the `api` monolith, modules communicate only through their exported service interfaces, never by importing another module's internal files. Each module's `index.ts` barrel file defines its public API.

---

## 2. Local Development

### 2.1 Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS+ | Runtime |
| pnpm | 9+ | Package manager (workspace-aware) |
| Docker Desktop / Podman | Latest | Infrastructure services |
| Git | 2.40+ | Version control |
| corepack | Bundled with Node 20 | pnpm version pinning |

Verify your environment:

```bash
node -v          # v20.x.x or higher
pnpm -v          # 9.x.x or higher
docker -v        # Docker version 27.x or higher
git --version    # git version 2.40+
```

### 2.2 docker-compose.yml

Located at `infra/docker/docker-compose.yml`. Provides every infrastructure dependency for local development.

```yaml
version: "3.9"

services:
  postgres:
    image: postgis/postgis:16-3.4
    container_name: coescd-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: coescd_dev
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ../../tools/migrations/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
    shm_size: "256mb"
    command: >
      postgres
      -c shared_preload_libraries=pg_stat_statements
      -c max_connections=200
      -c work_mem=16MB
      -c maintenance_work_mem=256MB
      -c effective_cache_size=1GB
      -c log_min_duration_statement=200

  redis:
    image: redis:7-alpine
    container_name: coescd-redis
    ports:
      - "6379:6379"
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - redis_data:/data

  nats:
    image: nats:2.10-alpine
    container_name: coescd-nats
    command:
      - "-js"
      - "-m"
      - "8222"
      - "--store_dir=/data"
    ports:
      - "4222:4222"   # Client
      - "8222:8222"   # Monitoring
    volumes:
      - nats_data:/data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8222/healthz"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: coescd-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: sentinel
      MINIO_ROOT_PASSWORD: coescd_dev
    ports:
      - "9000:9000"   # API
      - "9001:9001"   # Console
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 3

  minio-init:
    image: minio/mc:latest
    container_name: coescd-minio-init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set sentinel http://minio:9000 sentinel coescd_dev;
        mc mb --ignore-existing sentinel/coescd-uploads;
        mc mb --ignore-existing sentinel/coescd-documents;
        mc mb --ignore-existing sentinel/coescd-exports;
        mc mb --ignore-existing sentinel/coescd-avatars;
        mc anonymous set download sentinel/coescd-avatars;
        exit 0;
      "

  opensearch:
    image: opensearchproject/opensearch:2
    container_name: coescd-opensearch
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true
      - "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - os_data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:2
    container_name: coescd-opensearch-dashboards
    environment:
      - OPENSEARCH_HOSTS=["http://opensearch:9200"]
      - DISABLE_SECURITY_DASHBOARDS_PLUGIN=true
    ports:
      - "5601:5601"
    depends_on:
      opensearch:
        condition: service_healthy

  mailpit:
    image: axllent/mailpit:latest
    container_name: coescd-mailpit
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1

volumes:
  pg_data: {}
  redis_data: {}
  nats_data: {}
  minio_data: {}
  os_data: {}
```

**Service endpoints (local):**

| Service | URL / Port | Notes |
|---|---|---|
| PostgreSQL | `localhost:5432` | User: `postgres`, Pass: `dev` |
| Redis | `localhost:6379` | No auth in dev |
| NATS | `localhost:4222` (client), `localhost:8222` (monitor) | JetStream enabled |
| MinIO API | `localhost:9000` | User: `coescd`, Pass: `coescd_dev` |
| MinIO Console | `localhost:9001` | Browser UI |
| OpenSearch | `localhost:9200` | Security disabled in dev |
| OpenSearch Dashboards | `localhost:5601` | Query explorer |
| Mailpit SMTP | `localhost:1025` | Catches all outbound email |
| Mailpit Web | `localhost:8025` | View captured emails |

### 2.3 Getting Started

```bash
# 1. Clone the repository
git clone git@github.com:your-org/coescd.git
cd sentinel

# 2. Enable corepack (pins pnpm version from package.json)
corepack enable

# 3. Install all dependencies
pnpm install

# 4. Start infrastructure services
docker compose -f infra/docker/docker-compose.yml up -d

# 5. Wait for health checks to pass
docker compose -f infra/docker/docker-compose.yml ps
# All services should show "healthy"

# 6. Copy environment template
cp .env.example .env

# 7. Run database migrations (init.sql already ran via docker-entrypoint)
pnpm run db:migrate

# 8. Seed development data
pnpm run db:seed

# 9. Start all apps in parallel via Nx
pnpm run dev
```

After starting, the services are available at:

| App | URL |
|---|---|
| Web (Next.js) | `http://localhost:3000` |
| API | `http://localhost:3001/api` |
| API Swagger | `http://localhost:3001/api/docs` |
| Realtime | `ws://localhost:3002` |
| SFU Signaling | `ws://localhost:3003` |

Dev login credentials (from seed): `admin@coescd.local` / `Admin123!`

### 2.4 .env Template

```bash
# ==============================================================================
# CoESCD -- Environment Configuration
# Copy to .env and fill in values. All variables below are required unless
# marked [OPTIONAL].
# ==============================================================================

# ── General ───────────────────────────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=debug                          # trace | debug | info | warn | error
APP_PORT_API=3001
APP_PORT_REALTIME=3002
APP_PORT_WORKERS=3003
APP_PORT_SFU=3004
APP_PORT_WEB=3000

# ── Database (PostgreSQL 16 + PostGIS) ────────────────────────────────────────
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=dev
DATABASE_NAME=coescd_dev
DATABASE_SSL=false                       # true in production
DATABASE_POOL_SIZE=20
DATABASE_STATEMENT_TIMEOUT=3000          # ms

# ── Redis 7 ──────────────────────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                          # empty in dev
REDIS_DB=0
REDIS_TLS=false                          # true in production

# ── NATS JetStream ───────────────────────────────────────────────────────────
NATS_URL=nats://localhost:4222
NATS_USER=                               # empty in dev
NATS_PASSWORD=                           # empty in dev
NATS_TLS=false

# ── MinIO / S3 ───────────────────────────────────────────────────────────────
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=sentinel
S3_SECRET_KEY=coescd_dev
S3_REGION=us-east-1
S3_BUCKET_UPLOADS=coescd-uploads
S3_BUCKET_DOCUMENTS=coescd-documents
S3_BUCKET_EXPORTS=coescd-exports
S3_BUCKET_AVATARS=coescd-avatars
S3_FORCE_PATH_STYLE=true                 # required for MinIO

# ── OpenSearch ────────────────────────────────────────────────────────────────
OPENSEARCH_NODE=http://localhost:9200
OPENSEARCH_USERNAME=                     # empty in dev (security disabled)
OPENSEARCH_PASSWORD=
OPENSEARCH_TLS=false

# ── Authentication (JWT) ─────────────────────────────────────────────────────
JWT_ACCESS_SECRET=dev-access-secret-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
JWT_REFRESH_EXPIRY=7d
JWT_ISSUER=sentinel

# ── Email (SMTP) ─────────────────────────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@coescd.local
SMTP_TLS=false

# ── SMS [OPTIONAL] ───────────────────────────────────────────────────────────
# SMS_PROVIDER=twilio                    # twilio | vonage | mock
# SMS_ACCOUNT_SID=
# SMS_AUTH_TOKEN=
# SMS_FROM_NUMBER=

# ── mediasoup (SFU) ──────────────────────────────────────────────────────────
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1        # Public IP in production
MEDIASOUP_RTP_MIN_PORT=40000
MEDIASOUP_RTP_MAX_PORT=49999
MEDIASOUP_WORKERS=4                      # Usually = CPU cores

# ── External Integrations [OPTIONAL] ─────────────────────────────────────────
# WEATHER_API_URL=
# WEATHER_API_KEY=
# SEISMIC_FEED_URL=
# CAP_FEED_URL=

# ── Observability [OPTIONAL] ─────────────────────────────────────────────────
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
# OTEL_SERVICE_NAME=coescd-api
# METRICS_PORT=9090
```

### 2.5 Database Setup

**Schema initialization** (`tools/migrations/init.sql`):

```sql
-- Create extensions (requires superuser, done once at DB creation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create schemas (one per bounded context)
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS incident;
CREATE SCHEMA IF NOT EXISTS task;
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS comms;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS resource;
CREATE SCHEMA IF NOT EXISTS document;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS outbox;
```

**Migration order matters.** `iam` must run first because other schemas reference `iam.tenants` and `iam.users` via foreign keys:

```bash
# Migration runner (in package.json scripts)
"db:migrate": "pnpm run db:migrate:iam && pnpm run db:migrate:rest",
"db:migrate:iam": "node tools/migrations/run.js --schema=iam",
"db:migrate:rest": "node tools/migrations/run.js --schema=incident,task,geo,comms,notification,resource,document,analytics,integration,outbox",
"db:seed": "tsx tools/seed/dev-seed.ts",
"db:reset": "pnpm run db:drop && pnpm run db:create && pnpm run db:migrate && pnpm run db:seed",
"db:drop": "docker exec coescd-postgres psql -U postgres -c 'DROP DATABASE IF EXISTS coescd_dev;'",
"db:create": "docker exec coescd-postgres psql -U postgres -c 'CREATE DATABASE coescd_dev;' && docker exec coescd-postgres psql -U postgres -d coescd_dev -f /docker-entrypoint-initdb.d/init.sql"
```

**Seed data** creates:

- 1 tenant ("CoESCD Dev Agency")
- Admin user (`admin@coescd.local` / `Admin123!`)
- 5 sample roles (Admin, Incident Commander, Field Officer, Analyst, Observer)
- 3 sample incidents with varying severities
- 10 sample tasks across incidents
- 2 sample chat channels with messages
- Sample geospatial layers (country boundary, sample POIs)

---

## 3. Dockerfile Strategy

### 3.1 Multi-Stage Build Pattern

All five applications follow the same four-stage pattern. Below is the canonical template; per-app variations follow.

```dockerfile
# =============================================================================
# CoESCD Dockerfile -- Multi-Stage Build
# Template for: api | realtime | workers | sfu | web
# =============================================================================

# ── Stage 1: Base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Stage 2: Dependencies ────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy only files needed for dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/workers/package.json ./apps/workers/
COPY apps/sfu/package.json ./apps/sfu/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/ui/package.json ./packages/ui/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# Install only production dependencies for the target app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sentinel/${APP_NAME}...

# ── Stage 3: Build ───────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY --from=deps /app/ ./
COPY . .

RUN pnpm --filter @sentinel/${APP_NAME} build

# Prune dev dependencies after build
RUN pnpm prune --prod --filter @sentinel/${APP_NAME}...

# ── Stage 4: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

# Copy built output and production node_modules
COPY --from=build /app/apps/${APP_NAME}/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/${APP_NAME}/node_modules ./apps/${APP_NAME}/node_modules
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist

# Security: non-root user
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

### 3.2 Per-App Dockerfiles

**Dockerfile.api** -- Main monolith, straightforward:

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sentinel/api...

FROM base AS build
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
RUN pnpm --filter @sentinel/api build
RUN pnpm prune --prod --filter @sentinel/api...

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

**Dockerfile.workers** -- Includes OCR and AV scanning dependencies:

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sentinel/workers...

FROM base AS build
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
RUN pnpm --filter @sentinel/workers build
RUN pnpm prune --prod --filter @sentinel/workers...

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
# OCR support
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-rus
# Antivirus support
RUN apk add --no-cache clamav clamav-libunrar freshclam && \
    freshclam --quiet || true

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/workers/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

**Dockerfile.sfu** -- mediasoup requires native compilation:

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini python3 make g++ linux-headers
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/sfu/package.json ./apps/sfu/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sentinel/sfu...

FROM base AS build
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
RUN pnpm --filter @sentinel/sfu build
RUN pnpm prune --prod --filter @sentinel/sfu...

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini libc6-compat libstdc++
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/sfu/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3003
EXPOSE 40000-49999/udp
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

**Dockerfile.web** -- Next.js standalone output:

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sentinel/web...

FROM base AS build
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @sentinel/web build

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js standalone output copies only what's needed
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
```

### 3.3 Per-App Summary

| App | Base Image | Extra Alpine Packages | Exposed Ports | Notes |
|---|---|---|---|---|
| api | node:20-alpine | libc6-compat | 3000/tcp | Main monolith, stateless |
| realtime | node:20-alpine | libc6-compat | 3001/tcp | Sticky sessions required for Socket.IO |
| workers | node:20-alpine | libc6-compat, tesseract-ocr, clamav | 3002/tcp | OCR + antivirus scanning |
| sfu | node:20-alpine | libc6-compat, libstdc++ (runtime); python3, make, g++ (build) | 3003/tcp, 40000-49999/udp | mediasoup native addon, UDP for RTP |
| web | node:20-alpine | libc6-compat | 3000/tcp | Next.js standalone output mode |

### 3.4 Image Tagging Strategy

```bash
# Development (local builds)
sentinel/api:dev
sentinel/web:dev

# CI builds (every commit on any branch)
sentinel/api:abc1234                    # git commit SHA (first 7 chars)
sentinel/api:pr-42                      # PR number tag (overwritten per push)

# Latest from main (overwritten on each merge)
sentinel/api:latest

# Release tags (immutable)
sentinel/api:v1.2.3
sentinel/api:v1.2                       # floating minor tag

# Multi-architecture
docker buildx build --platform linux/amd64,linux/arm64 \
  -t sentinel/api:v1.2.3 \
  -f infra/docker/Dockerfile.api \
  --push .
```

### 3.5 Security Hardening

Every production image follows these rules:

1. **Non-root execution**: All containers run as the `node` user (UID 1000). No `sudo`, no capability escalation.

2. **tini init process**: Proper PID 1 that forwards signals and reaps zombies. Prevents the Node.js process from missing SIGTERM during pod termination.

3. **No dev dependencies**: `pnpm prune --prod` strips test frameworks, linters, and build tools from the runtime image.

4. **Read-only root filesystem**: Enforced at the Kubernetes level via `securityContext.readOnlyRootFilesystem: true`. Temporary writes go to an `emptyDir` volume mounted at `/tmp`.

5. **Image signing**: Every CI-built image is signed with [cosign](https://github.com/sigstore/cosign):

   ```bash
   cosign sign --key cosign.key sentinel/api:v1.2.3
   cosign verify --key cosign.pub sentinel/api:v1.2.3
   ```

6. **Vulnerability scanning**: Trivy runs in CI against every built image. The pipeline fails on CRITICAL or HIGH severity findings:

   ```bash
   trivy image --exit-code 1 --severity CRITICAL,HIGH sentinel/api:${COMMIT_SHA}
   ```

7. **SBOM generation**: CycloneDX Software Bill of Materials produced for every release image:

   ```bash
   trivy image --format cyclonedx --output sbom-api.json sentinel/api:v1.2.3
   ```

---

## 4. CI/CD Pipeline

### 4.1 Pipeline Stages

The pipeline has 7 stages, gated sequentially. Failure at any stage halts the pipeline.

```
 Lint ──> Test ──> Build ──> Scan ──> Deploy Staging ──> E2E ──> Deploy Prod
 ~2m      ~8m      ~5m      ~3m       ~5m                ~10m     ~20m
                                                                  (manual gate)
```

**Stage 1: Lint** (~2 minutes)

- ESLint with architectural boundary rules (`@nx/enforce-module-boundaries`)
- Prettier format check (`prettier --check .`)
- TypeScript type check (`tsc --noEmit` per project)
- Commit message lint (conventional commits via commitlint)

**Stage 2: Test** (~8 minutes)

- Unit tests: Vitest, per-module, parallelized by Nx affected
- Integration tests: Testcontainers (ephemeral PostgreSQL 16 + PostGIS, Redis 7, NATS per test suite)
- Contract tests: validate OpenAPI specs match implementation, event schemas match published events
- Coverage gates: minimum 80% line coverage for `iam`, `incident`, `task` modules; 60% for others

**Stage 3: Build** (~5 minutes)

- Docker buildx for multi-architecture (linux/amd64, linux/arm64)
- Push to container registry tagged with commit SHA
- Nx affected determines which apps actually need rebuilding

**Stage 4: Scan** (~3 minutes)

- Trivy: container image vulnerability scan, fail on CRITICAL or HIGH
- Snyk: dependency vulnerability scan against lockfile
- SBOM: CycloneDX generation attached as build artifact
- cosign: image signing with keyless (Fulcio) or key-based signing

**Stage 5: Deploy Staging** (~5 minutes)

- Argo CD Application sync: update image tag in Helm values
- Wait for Kubernetes rollout to complete
- Run smoke tests: health probe checks, basic CRUD against staging API

**Stage 6: E2E Tests** (~10 minutes)

- Playwright test suite executes against the staging environment
- Critical user journeys: login, create incident, assign tasks, send chat message, upload file, view map layer, run report export
- Screenshot comparison for visual regression on key screens
- Accessibility audit (axe-core) on all pages

**Stage 7: Deploy Production** (~20 minutes)

- Manual approval gate (requires at least one SRE or team lead)
- Canary deployment: 5% traffic for 5 minutes, 25% for 5 minutes, 100%
- Each step: automated SLO observation (error rate < 1%, p99 latency < 2s)
- Automatic rollback if SLO breached during any canary step
- Post-deploy: verify health probes, send deployment notification to ops channel

### 4.2 GitHub Actions Configuration

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/${{ github.repository_owner }}/sentinel
  NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}

jobs:
  # ── Stage 1: Lint ─────────────────────────────────────────────────────────
  lint:
    name: Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Nx affected lint
        run: pnpm exec nx affected -t lint --base=origin/main

      - name: Prettier check
        run: pnpm exec prettier --check .

      - name: TypeScript type check
        run: pnpm exec nx affected -t typecheck --base=origin/main

      - name: Commitlint
        if: github.event_name == 'pull_request'
        run: |
          pnpm exec commitlint --from ${{ github.event.pull_request.base.sha }} \
                               --to ${{ github.event.pull_request.head.sha }}

  # ── Stage 2: Test ─────────────────────────────────────────────────────────
  test:
    name: Test
    needs: lint
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: sentinel_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
      nats:
        image: nats:2.10-alpine
        ports: ["4222:4222"]
        options: >-
          --entrypoint "nats-server"
          -- -js

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run migrations
        env:
          DATABASE_HOST: localhost
          DATABASE_PORT: 5432
          DATABASE_USER: postgres
          DATABASE_PASSWORD: test
          DATABASE_NAME: sentinel_test
        run: pnpm run db:migrate

      - name: Unit + Integration tests
        env:
          DATABASE_HOST: localhost
          DATABASE_PORT: 5432
          DATABASE_USER: postgres
          DATABASE_PASSWORD: test
          DATABASE_NAME: sentinel_test
          REDIS_HOST: localhost
          REDIS_PORT: 6379
          NATS_URL: nats://localhost:4222
        run: pnpm exec nx affected -t test --base=origin/main --coverage

      - name: Check coverage thresholds
        run: pnpm exec nx affected -t test:coverage-check --base=origin/main

      - name: Contract tests
        run: pnpm exec nx run @sentinel/contracts:validate

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-reports
          path: coverage/

  # ── Stage 3: Build ────────────────────────────────────────────────────────
  build:
    name: Build Images
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        app: [api, realtime, workers, sfu, web]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Check if app is affected
        id: affected
        run: |
          pnpm exec nx show projects --affected --base=origin/main | grep -q "@sentinel/${{ matrix.app }}" \
            && echo "build=true" >> "$GITHUB_OUTPUT" \
            || echo "build=false" >> "$GITHUB_OUTPUT"

      - name: Build and push
        if: steps.affected.outputs.build == 'true'
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/Dockerfile.${{ matrix.app }}
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
          tags: |
            ${{ env.IMAGE_PREFIX }}/${{ matrix.app }}:${{ github.sha }}
            ${{ env.IMAGE_PREFIX }}/${{ matrix.app }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ── Stage 4: Scan ─────────────────────────────────────────────────────────
  scan:
    name: Security Scan
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    strategy:
      matrix:
        app: [api, realtime, workers, sfu, web]
    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.IMAGE_PREFIX }}/${{ matrix.app }}:${{ github.sha }}
          format: table
          exit-code: 1
          severity: CRITICAL,HIGH
          ignore-unfixed: true

      - name: Generate SBOM
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.IMAGE_PREFIX }}/${{ matrix.app }}:${{ github.sha }}
          format: cyclonedx
          output: sbom-${{ matrix.app }}.json

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ matrix.app }}
          path: sbom-${{ matrix.app }}.json

      - name: Sign image with cosign
        uses: sigstore/cosign-installer@v3
      - run: |
          cosign sign --yes ${{ env.IMAGE_PREFIX }}/${{ matrix.app }}:${{ github.sha }}

  # ── Stage 5: Deploy Staging ───────────────────────────────────────────────
  deploy-staging:
    name: Deploy Staging
    needs: scan
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Update staging image tags
        run: |
          for app in api realtime workers sfu web; do
            yq eval ".${app}.image.tag = \"${{ github.sha }}\"" \
              -i infra/k8s/values-staging.yaml
          done

      - name: Sync Argo CD
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app sync coescd-staging
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Wait for rollout
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app wait coescd-staging --health --timeout 300
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Smoke tests
        run: |
          STAGING_URL="${{ secrets.STAGING_URL }}"
          # Health checks
          curl -sf "${STAGING_URL}/api/healthz" || exit 1
          curl -sf "${STAGING_URL}/api/readyz" || exit 1
          echo "Smoke tests passed"

  # ── Stage 6: E2E Tests ───────────────────────────────────────────────────
  e2e:
    name: E2E Tests
    needs: deploy-staging
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E suite
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          E2E_ADMIN_EMAIL: ${{ secrets.E2E_ADMIN_EMAIL }}
          E2E_ADMIN_PASSWORD: ${{ secrets.E2E_ADMIN_PASSWORD }}
        run: pnpm exec playwright test --project=chromium

      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/

  # ── Stage 7: Deploy Production ───────────────────────────────────────────
  deploy-production:
    name: Deploy Production
    needs: e2e
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: production    # Requires manual approval
    steps:
      - uses: actions/checkout@v4

      - name: Update production image tags
        run: |
          for app in api realtime workers sfu web; do
            yq eval ".${app}.image.tag = \"${{ github.sha }}\"" \
              -i infra/k8s/values-production.yaml
          done

      - name: Canary -- 5% traffic
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app set coescd-production -p canary.weight=5
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Sync and wait (5%)
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app sync coescd-production
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Observe SLOs (5min)
        run: |
          echo "Observing error rate and latency for 5 minutes..."
          for i in $(seq 1 30); do
            ERROR_RATE=$(curl -sf "${{ secrets.PROMETHEUS_URL }}/api/v1/query?query=sentinel_http_error_rate_5m" | jq -r '.data.result[0].value[1]')
            P99=$(curl -sf "${{ secrets.PROMETHEUS_URL }}/api/v1/query?query=sentinel_http_latency_p99_5m" | jq -r '.data.result[0].value[1]')
            if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )) || (( $(echo "$P99 > 2.0" | bc -l) )); then
              echo "SLO breach detected: error_rate=${ERROR_RATE}, p99=${P99}s -- rolling back"
              exit 1
            fi
            sleep 10
          done
          echo "SLOs healthy at 5% canary"

      - name: Canary -- 25% traffic
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app set coescd-production -p canary.weight=25
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Observe SLOs (5min at 25%)
        run: |
          for i in $(seq 1 30); do
            ERROR_RATE=$(curl -sf "${{ secrets.PROMETHEUS_URL }}/api/v1/query?query=sentinel_http_error_rate_5m" | jq -r '.data.result[0].value[1]')
            P99=$(curl -sf "${{ secrets.PROMETHEUS_URL }}/api/v1/query?query=sentinel_http_latency_p99_5m" | jq -r '.data.result[0].value[1]')
            if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )) || (( $(echo "$P99 > 2.0" | bc -l) )); then
              echo "SLO breach at 25% -- rolling back"
              exit 1
            fi
            sleep 10
          done

      - name: Full rollout -- 100% traffic
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app set coescd-production -p canary.weight=100
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Final sync
        uses: clowdhaus/argo-cd-action@v2
        env:
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
        with:
          command: app sync coescd-production
          options: --grpc-web --server ${{ secrets.ARGOCD_SERVER }}

      - name: Verify deployment
        run: |
          curl -sf "${{ secrets.PRODUCTION_URL }}/api/healthz" || exit 1
          curl -sf "${{ secrets.PRODUCTION_URL }}/api/readyz" || exit 1
          echo "Production deployment verified"

      - name: Notify
        if: always()
        run: |
          STATUS=${{ job.status }}
          curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
            -H 'Content-Type: application/json' \
            -d "{\"text\":\"CoESCD production deploy ${STATUS}: ${{ github.sha }}\"}"
```

### 4.3 Branch Strategy

```
main ─────────────────●──────●──────●──────●─────── (always deployable)
                     / \    /      /      /
feature/IAM-42 ────●───●──●      /      /
                               /      /
feature/GEO-78 ──────────●───●      /
                                   /
hotfix/CVE-2026-1234 ────────────●   (merged to main + cherry-picked to release)

release/v1.2 ────────────────────●─── (cut from main, receives hotfixes only)
```

**Rules:**

- `main` is always deployable. Branch protection requires: CI green + 1 approval + no force-push.
- `feature/*` branches are short-lived (< 1 week). Squash-merged via PR.
- `release/*` branches are cut from `main` when preparing a versioned release for on-prem customers. Only hotfixes are cherry-picked onto release branches.
- Hotfixes merge to `main` first, then cherry-pick to affected release branches.
- No long-lived develop branch. `main` is the trunk.

---

## 5. Kubernetes Architecture

### 5.1 Helm Chart Structure

```
infra/k8s/
├── Chart.yaml                    # Umbrella chart metadata
├── Chart.lock                    # Dependency lock
├── values.yaml                   # Default values (base)
├── values-staging.yaml           # Staging overrides
├── values-production.yaml        # Production overrides
├── values-onprem.yaml            # Sovereign/on-prem overrides
├── templates/
│   ├── _helpers.tpl              # Shared template helpers
│   └── namespace.yaml            # sentinel namespace
├── charts/
│   ├── api/
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   │       ├── deployment.yaml
│   │       ├── service.yaml
│   │       ├── hpa.yaml
│   │       ├── pdb.yaml
│   │       ├── networkpolicy.yaml
│   │       ├── serviceaccount.yaml
│   │       ├── configmap.yaml
│   │       └── ingress.yaml
│   ├── realtime/
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   │       ├── deployment.yaml
│   │       ├── service.yaml
│   │       ├── hpa.yaml
│   │       ├── pdb.yaml
│   │       ├── networkpolicy.yaml
│   │       ├── serviceaccount.yaml
│   │       └── configmap.yaml
│   ├── workers/
│   │   └── ... (same template set)
│   ├── sfu/
│   │   └── ... (same template set, plus UDP service)
│   ├── web/
│   │   └── ... (same template set)
│   ├── postgres/
│   │   └── ... (StatefulSet, PVC, backup CronJob)
│   ├── redis/
│   │   └── ... (StatefulSet, PVC, CoESCD config)
│   ├── nats/
│   │   └── ... (StatefulSet, PVC, JetStream config)
│   ├── minio/
│   │   └── ... (StatefulSet, PVC, erasure coding config)
│   └── opensearch/
│       └── ... (StatefulSet, PVC, index templates)
```

### 5.2 Deployment Specifications

**API Deployment:**

```yaml
# charts/api/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "api.fullname" . }}
  labels:
    {{- include "api.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      {{- include "api.selectorLabels" . | nindent 6 }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        {{- include "api.selectorLabels" . | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: {{ include "api.serviceAccountName" . }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      terminationGracePeriodSeconds: 30
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              {{- include "api.selectorLabels" . | nindent 14 }}
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              {{- include "api.selectorLabels" . | nindent 14 }}
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
          env:
            - name: NODE_ENV
              value: "production"
            - name: APP_PORT_API
              value: "3000"
            - name: DATABASE_HOST
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: DATABASE_HOST
            - name: DATABASE_PORT
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: DATABASE_PORT
            - name: DATABASE_NAME
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: DATABASE_NAME
            - name: DATABASE_USER
              valueFrom:
                secretKeyRef:
                  name: coescd-db-credentials
                  key: username
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: coescd-db-credentials
                  key: password
            - name: DATABASE_SSL
              value: "true"
            - name: REDIS_HOST
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: REDIS_HOST
            - name: REDIS_PORT
              value: "6379"
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: coescd-redis-credentials
                  key: password
            - name: NATS_URL
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: NATS_URL
            - name: S3_ENDPOINT
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: S3_ENDPOINT
            - name: S3_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: coescd-minio-credentials
                  key: access-key
            - name: S3_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: coescd-minio-credentials
                  key: secret-key
            - name: OPENSEARCH_NODE
              valueFrom:
                configMapKeyRef:
                  name: {{ include "api.fullname" . }}-config
                  key: OPENSEARCH_NODE
            - name: JWT_ACCESS_SECRET
              valueFrom:
                secretKeyRef:
                  name: coescd-jwt-keys
                  key: access-secret
            - name: JWT_REFRESH_SECRET
              valueFrom:
                secretKeyRef:
                  name: coescd-jwt-keys
                  key: refresh-secret
          resources:
            requests:
              cpu: {{ .Values.resources.requests.cpu }}
              memory: {{ .Values.resources.requests.memory }}
            limits:
              cpu: {{ .Values.resources.limits.cpu }}
              memory: {{ .Values.resources.limits.memory }}
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 12
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 100Mi
```

**Default resource profiles per app:**

| App | CPU Request | CPU Limit | Memory Request | Memory Limit |
|---|---|---|---|---|
| api | 500m | 2000m | 512Mi | 1Gi |
| realtime | 250m | 1000m | 256Mi | 512Mi |
| workers | 500m | 2000m | 512Mi | 2Gi |
| sfu | 1000m | 4000m | 512Mi | 1Gi |
| web | 250m | 1000m | 256Mi | 512Mi |

### 5.3 HPA Configuration

```yaml
# charts/api/templates/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "api.fullname" . }}
  labels:
    {{- include "api.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "api.fullname" . }}
  minReplicas: {{ .Values.hpa.minReplicas }}
  maxReplicas: {{ .Values.hpa.maxReplicas }}
  behavior:
    scaleUp:
      stabilizationWindowSeconds: {{ .Values.hpa.scaleUpCooldown }}
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.hpa.targetCPU }}
```

**HPA values per service:**

| Service | Min Replicas | Max Replicas | CPU Target | Custom Metric | Scale-Up Cooldown |
|---|---|---|---|---|---|
| api | 3 | 20 | 70% | -- | 60s |
| realtime | 3 | 30 | 60% | `ws_connected_total > 40000/pod` | 120s |
| workers | 2 | 15 | 80% | `nats_consumer_pending > 1000` | 60s |
| sfu | 2 | 10 | 70% | `mediasoup_active_calls > 50/pod` | 60s |
| web | 2 | 10 | 70% | -- | 60s |

**Custom metrics HPA example (realtime):**

```yaml
# charts/realtime/templates/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "realtime.fullname" . }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "realtime.fullname" . }}
  minReplicas: 3
  maxReplicas: 30
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 120
      policies:
        - type: Pods
          value: 3
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Pods
      pods:
        metric:
          name: ws_connected_total
        target:
          type: AverageValue
          averageValue: "40000"
```

### 5.4 PodDisruptionBudget

Applied to every service to protect availability during voluntary disruptions (node drains, cluster upgrades):

```yaml
# charts/api/templates/pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "api.fullname" . }}
  labels:
    {{- include "api.labels" . | nindent 4 }}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      {{- include "api.selectorLabels" . | nindent 6 }}
```

**PDB per service:**

| Service | minAvailable | Rationale |
|---|---|---|
| api | 1 | At least 1 pod serves requests during rolling updates |
| realtime | 1 | WebSocket connections migrate gradually |
| workers | 1 | At least 1 consumer processes events |
| sfu | 1 | Active calls protected |
| web | 1 | Frontend always reachable |
| postgres | 1 | Database always available (StatefulSet) |
| redis | 1 | Cache/pub-sub always available |
| nats | 2 | NATS cluster quorum (3-node cluster, need 2 for quorum) |

### 5.5 NetworkPolicies

Default policy: deny all ingress and egress for every pod in the `coescd` namespace:

```yaml
# templates/default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: sentinel
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

**API NetworkPolicy (full):**

```yaml
# charts/api/templates/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "api.fullname" . }}
  namespace: sentinel
  labels:
    {{- include "api.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "api.selectorLabels" . | nindent 6 }}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow traffic from ingress controller (edge)
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
          podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - port: 3000
          protocol: TCP
    # Allow traffic from web (BFF -> API)
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-web
      ports:
        - port: 3000
          protocol: TCP
    # Allow traffic from workers (internal API calls)
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-workers
      ports:
        - port: 3000
          protocol: TCP
    # Allow Prometheus scraping
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
          podSelector:
            matchLabels:
              app.kubernetes.io/name: prometheus
      ports:
        - port: 3000
          protocol: TCP
  egress:
    # DNS resolution
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    # PostgreSQL
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-postgres
      ports:
        - port: 5432
          protocol: TCP
    # Redis
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-redis
      ports:
        - port: 6379
          protocol: TCP
    # NATS
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-nats
      ports:
        - port: 4222
          protocol: TCP
    # MinIO
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-minio
      ports:
        - port: 9000
          protocol: TCP
    # OpenSearch
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: coescd-opensearch
      ports:
        - port: 9200
          protocol: TCP
```

**NetworkPolicy summary for all services:**

| Service | Ingress From | Egress To |
|---|---|---|
| api | ingress-nginx, web, workers, prometheus | postgres, redis, nats, minio, opensearch, kube-dns |
| realtime | ingress-nginx (WSS), prometheus | redis, nats, kube-dns |
| workers | prometheus | postgres, redis, nats, minio, opensearch, kube-dns |
| sfu | ingress-nginx (TCP+UDP), prometheus | redis, nats, minio, kube-dns |
| web | ingress-nginx, prometheus | api, kube-dns |
| postgres | api, workers | kube-dns (for replication DNS) |
| redis | api, realtime, workers, sfu | kube-dns |
| nats | api, realtime, workers, sfu | kube-dns (for cluster peering) |
| minio | api, workers, sfu | kube-dns |
| opensearch | api, workers | kube-dns |

### 5.6 Secrets Management

Secrets are never stored in Git, environment variables, or ConfigMaps as plaintext.

**Primary approach: External Secrets Operator + HashiCorp Vault**

```yaml
# Example: ExternalSecret for database credentials
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: coescd-db-credentials
  namespace: sentinel
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: coescd-db-credentials
    creationPolicy: Owner
  data:
    - secretKey: username
      remoteRef:
        key: secret/data/sentinel/database
        property: username
    - secretKey: password
      remoteRef:
        key: secret/data/sentinel/database
        property: password
```

```yaml
# ClusterSecretStore for Vault
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.internal:8200"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "sentinel"
          serviceAccountRef:
            name: coescd-vault-auth
```

**Alternative for air-gapped environments: Sealed Secrets**

```bash
# Encrypt a secret for Git storage (only the cluster can decrypt)
kubeseal --format yaml < secret.yaml > sealed-secret.yaml

# sealed-secret.yaml is safe to commit to Git
```

**Secret rotation schedule:**

| Secret | Rotation Period | Method |
|---|---|---|
| Database credentials | 24h | Vault dynamic secrets |
| JWT access signing key | 90 days | Vault KV, dual-key overlap during rotation |
| JWT refresh signing key | 90 days | Vault KV, dual-key overlap during rotation |
| MinIO credentials | 180 days | Vault KV |
| NATS credentials | 180 days | Vault KV |
| Redis password | 180 days | Vault KV |
| TLS certificates | Auto-renew | cert-manager (Let's Encrypt or internal CA) |

---

## 6. Storage Classes

### 6.1 Storage Class Definitions

```yaml
# Fast SSD -- for latency-sensitive stateful workloads
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/no-provisioner   # Local PV for on-prem
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
allowVolumeExpansion: true
parameters:
  type: nvme
---
# Standard SSD -- for replicas and general stateful workloads
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard-ssd
provisioner: rancher.io/local-path           # Or OpenEBS, Longhorn
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
allowVolumeExpansion: true
---
# Bulk storage -- large capacity, lower performance
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: bulk
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
allowVolumeExpansion: true
---
# Backup storage -- for WAL archives, base backups
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: backup
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
```

### 6.2 Storage Allocation

| Storage Class | Backing | Used By | IOPS | Capacity | Notes |
|---|---|---|---|---|---|
| `fast-ssd` | NVMe SSD | PostgreSQL primary, Redis primary | High (50K+) | 500GB - 2TB | Local PV, pin pods to nodes with NVMe |
| `standard-ssd` | SATA SSD | PostgreSQL replicas, NATS JetStream | Medium (10K) | 500GB - 2TB | Can be replicated (Longhorn/Ceph) |
| `bulk` | HDD or Object | MinIO data, cold partitions, OpenSearch | Low (1-5K) | 10TB+ | Large capacity, erasure-coded |
| `backup` | S3-compatible or remote HDD | WAL archives, base backups, snapshots | Low | Unlimited | Off-site or separate rack |

### 6.3 On-Prem Storage Provider Mapping

| Cloud Equivalent | On-Prem Option | Notes |
|---|---|---|
| AWS gp3 / GCP pd-ssd | OpenEBS LocalPV, Longhorn | Replicated block storage |
| AWS io2 | Local NVMe (no-provisioner) | Pin via node affinity |
| AWS S3 | MinIO (already in stack) | Also serves as backup target |
| AWS EBS snapshots | Longhorn snapshots, Velero + Restic | Volume-level backup |
| Ceph RBD | Rook-Ceph operator | Full-featured, more complex |

---

## 7. Sovereign / On-Prem Deployment

### 7.1 Design Principles

The CoESCD platform is designed to run identically in cloud and on-premises environments. The same Helm chart serves both -- only the `values` file changes.

**Key constraints for sovereign deployments:**

- No cloud-provider-specific Kubernetes objects (no `aws-load-balancer-controller` annotations, no GCP PD provisioner)
- No outbound internet access required at runtime
- All container images available from an internal registry
- DNS resolution works with internal DNS or static `/etc/hosts`
- Time synchronization from an internal NTP source
- Certificate management without Let's Encrypt (internal CA)

**Architecture equivalence table:**

| Cloud Component | On-Prem Equivalent | Configured Via |
|---|---|---|
| AWS ALB / GCP GLB | MetalLB + Nginx Ingress Controller | `values-onprem.yaml` |
| AWS EBS / GCP PD | Longhorn, OpenEBS, or Rook-Ceph | StorageClass definitions |
| AWS RDS | PostgreSQL on Kubernetes (CloudNativePG or manual StatefulSet) | Subchart |
| AWS ElastiCache | Redis on Kubernetes | Subchart |
| AWS S3 | MinIO (already in architecture) | Same subchart |
| AWS ACM | cert-manager with internal CA | Issuer config |
| AWS Route 53 | CoreDNS or internal DNS | Manual configuration |
| AWS Secrets Manager | Vault on Kubernetes or Sealed Secrets | ExternalSecret config |

### 7.2 Air-Gap Support

**Image mirroring:**

```bash
#!/usr/bin/env bash
# tools/scripts/mirror-images.sh
# Mirror all required images to an internal registry for air-gapped deployment

set -euo pipefail

INTERNAL_REGISTRY="${1:?Usage: $0 <internal-registry-url>}"
COESCD_VERSION="${2:-latest}"

# Application images
COESCD_IMAGES=(
  "sentinel/api:${COESCD_VERSION}"
  "sentinel/realtime:${COESCD_VERSION}"
  "sentinel/workers:${COESCD_VERSION}"
  "sentinel/sfu:${COESCD_VERSION}"
  "sentinel/web:${COESCD_VERSION}"
)

# Infrastructure images
INFRA_IMAGES=(
  "postgis/postgis:16-3.4"
  "redis:7-alpine"
  "nats:2.10-alpine"
  "minio/minio:latest"
  "opensearchproject/opensearch:2"
  "nginx/nginx-ingress:3.4"
  "metallb/speaker:v0.14"
  "metallb/controller:v0.14"
  "quay.io/jetstack/cert-manager-controller:v1.14"
  "quay.io/jetstack/cert-manager-webhook:v1.14"
  "quay.io/jetstack/cert-manager-cainjector:v1.14"
  "longhornio/longhorn-manager:v1.6"
  "longhornio/longhorn-engine:v1.6"
  "longhornio/longhorn-ui:v1.6"
)

for img in "${COESCD_IMAGES[@]}" "${INFRA_IMAGES[@]}"; do
  echo "Mirroring ${img} -> ${INTERNAL_REGISTRY}/${img}"
  docker pull "${img}"
  docker tag "${img}" "${INTERNAL_REGISTRY}/${img}"
  docker push "${INTERNAL_REGISTRY}/${img}"
done

echo "All images mirrored to ${INTERNAL_REGISTRY}"
```

**Helm chart bundling:**

```bash
# Package umbrella chart with all dependencies
helm dependency update infra/k8s/
helm package infra/k8s/ -d ./release/

# Transfer release/coescd-1.2.3.tgz to air-gapped environment
# Install from local file
helm install sentinel ./coescd-1.2.3.tgz \
  -f values-onprem.yaml \
  --namespace sentinel \
  --create-namespace
```

**Runtime network isolation guarantees:**

- All NATS, Redis, PostgreSQL, MinIO, and OpenSearch connections are intra-cluster
- No telemetry or analytics phone-home
- External integrations (weather, seismic, CAP feeds) are optional and disabled by default in on-prem values
- Node.js `--dns-result-order=ipv4first` prevents unexpected IPv6 lookups
- `NEXT_TELEMETRY_DISABLED=1` prevents Next.js telemetry

### 7.3 Hardware Requirements

**Minimum production deployment (supports up to 5000 concurrent users):**

| Component | Nodes | CPU per Node | RAM per Node | Storage per Node | Notes |
|---|---|---|---|---|---|
| K8s control plane | 3 | 4 vCPU | 8 GB | 100 GB SSD | HA etcd, stacked topology |
| K8s worker (app) | 3+ | 8 vCPU | 32 GB | 200 GB SSD | api, web, realtime, workers |
| K8s worker (data) | 3 | 8 vCPU | 64 GB | 1 TB NVMe | PostgreSQL, Redis, NATS |
| K8s worker (media) | 2 | 16 vCPU | 16 GB | 200 GB SSD | mediasoup SFU (CPU-bound) |
| MinIO nodes | 4 | 4 vCPU | 16 GB | 10 TB HDD | Erasure coding (4-node min) |
| **Total** | **15+** | **~100 vCPU** | **~300 GB** | **~45 TB** | |

**Compact deployment (lab/pilot, up to 500 concurrent users):**

| Component | Nodes | CPU per Node | RAM per Node | Storage per Node |
|---|---|---|---|---|
| K8s all-in-one | 3 | 16 vCPU | 64 GB | 1 TB SSD |
| MinIO (co-located) | (same 3 nodes) | -- | -- | + 2 TB HDD each |
| **Total** | **3** | **48 vCPU** | **192 GB** | **~9 TB** |

**Network requirements:**

- 10 Gbps between all nodes (minimum 1 Gbps)
- Dedicated VLAN for cluster traffic
- Low-latency interconnect for database nodes (< 1ms RTT)
- Firewall: only ports 80/443 (ingress), 6443 (K8s API), and SSH exposed externally

### 7.4 Installation Procedure

Complete step-by-step for a fresh on-premises installation.

**Step 1: Provision infrastructure**

```bash
# Verify all nodes are reachable and meet minimum specs
for node in cp1 cp2 cp3 worker1 worker2 worker3 data1 data2 data3 media1 media2 minio1 minio2 minio3 minio4; do
  ssh ${node} "hostname && nproc && free -h && df -h"
done
```

**Step 2: Install Kubernetes (RKE2 recommended for on-prem)**

```bash
# On first control plane node
curl -sfL https://get.rke2.io | INSTALL_RKE2_TYPE=server sh -
systemctl enable --now rke2-server.service

# Get join token
cat /var/lib/rancher/rke2/server/node-token

# On additional control plane nodes
curl -sfL https://get.rke2.io | INSTALL_RKE2_TYPE=server sh -
echo "server: https://cp1:9345" >> /etc/rancher/rke2/config.yaml
echo "token: <TOKEN>" >> /etc/rancher/rke2/config.yaml
systemctl enable --now rke2-server.service

# On worker nodes
curl -sfL https://get.rke2.io | INSTALL_RKE2_TYPE=agent sh -
echo "server: https://cp1:9345" >> /etc/rancher/rke2/config.yaml
echo "token: <TOKEN>" >> /etc/rancher/rke2/config.yaml
systemctl enable --now rke2-agent.service
```

**Step 3: Label nodes by role**

```bash
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml

# App workers
kubectl label node worker1 worker2 worker3 coescd.io/role=app

# Data workers
kubectl label node data1 data2 data3 coescd.io/role=data

# Media workers
kubectl label node media1 media2 coescd.io/role=media

# MinIO nodes
kubectl label node minio1 minio2 minio3 minio4 coescd.io/role=storage
```

**Step 4: Install storage operator (Longhorn)**

```bash
# From air-gap bundle or Helm chart
helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --create-namespace \
  --set defaultSettings.defaultDataPath=/var/lib/longhorn \
  --set defaultSettings.defaultReplicaCount=2
```

**Step 5: Install MetalLB + Nginx Ingress**

```bash
# MetalLB
helm install metallb metallb/metallb \
  --namespace metallb-system \
  --create-namespace

# Configure IP address pool
kubectl apply -f - <<YAML
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: coescd-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.1.200-192.168.1.210   # Adjust to your network
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: coescd-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - coescd-pool
YAML

# Nginx Ingress Controller
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.config.proxy-body-size=100m \
  --set controller.config.proxy-read-timeout=60 \
  --set controller.config.websocket-services=coescd-realtime
```

**Step 6: Install cert-manager with internal CA**

```bash
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Create internal CA issuer
kubectl apply -f - <<YAML
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: coescd-ca-issuer
spec:
  ca:
    secretName: coescd-ca-keypair
YAML

# Create the CA keypair secret (generate with openssl beforehand)
kubectl create secret tls coescd-ca-keypair \
  --cert=ca.crt --key=ca.key \
  -n cert-manager
```

**Step 7: Load images into internal registry**

```bash
# If using an internal Harbor/Registry
./tools/scripts/mirror-images.sh registry.internal.local:5000 v1.2.3
```

**Step 8: Deploy CoESCD**

```bash
# Create namespace
kubectl create namespace sentinel

# Install Vault or create Sealed Secrets for credentials
# (Vault installation omitted for brevity -- use Vault Helm chart)

# Deploy the CoESCD umbrella chart
helm install sentinel ./infra/k8s/ \
  --namespace sentinel \
  -f infra/k8s/values-onprem.yaml \
  --set global.imageRegistry=registry.internal.local:5000 \
  --wait --timeout 10m
```

**Step 9: Run migrations and seed**

```bash
# Run migrations via a Kubernetes Job
kubectl apply -f - <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: coescd-migrate
  namespace: sentinel
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: registry.internal.local:5000/sentinel/api:v1.2.3
          command: ["node", "dist/cli.js", "migrate"]
          envFrom:
            - configMapRef:
                name: coescd-api-config
            - secretRef:
                name: coescd-db-credentials
YAML

kubectl wait --for=condition=complete job/coescd-migrate -n sentinel --timeout=120s

# Seed initial data
kubectl apply -f - <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: coescd-seed
  namespace: sentinel
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: seed
          image: registry.internal.local:5000/sentinel/api:v1.2.3
          command: ["node", "dist/cli.js", "seed", "--admin-email=admin@coescd.gov", "--admin-password=CHANGE_ME"]
          envFrom:
            - configMapRef:
                name: coescd-api-config
            - secretRef:
                name: coescd-db-credentials
YAML
```

**Step 10: Verify and create first tenant**

```bash
# Check all pods are running
kubectl get pods -n sentinel

# Check health probes
INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

curl -sf "http://${INGRESS_IP}/api/healthz" && echo "Health OK"
curl -sf "http://${INGRESS_IP}/api/readyz" && echo "Ready OK"

# The seed step already creates the first tenant and admin user
# Login at https://coescd.internal/ with the admin credentials
echo "Installation complete. Access CoESCD at https://coescd.internal/"
```

---

## 8. Resilience Patterns

### 8.1 HTTP Client Retries

All outbound HTTP requests use a shared retry-capable HTTP client. The strategy is exponential backoff with full jitter, which distributes retry storms across time.

```typescript
// apps/api/src/shared/http/resilient-http.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 50,
  maxDelayMs: 1600,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

@Injectable()
export class ResilientHttpService {
  private readonly logger = new Logger(ResilientHttpService.name);
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 10_000,
      headers: { 'User-Agent': 'CoESCD/1.0' },
    });
  }

  async request<T>(
    config: AxiosRequestConfig & {
      retry?: Partial<RetryConfig>;
      idempotent?: boolean;
    },
  ): Promise<AxiosResponse<T>> {
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    const isIdempotent = config.idempotent ?? config.method?.toUpperCase() === 'GET';

    // Attach Idempotency-Key header for idempotent writes
    if (isIdempotent && config.method?.toUpperCase() !== 'GET') {
      config.headers = {
        ...config.headers,
        'Idempotency-Key': config.headers?.['Idempotency-Key'] ?? uuidv4(),
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        const response = await this.client.request<T>(config);
        return response;
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;

        // Never retry non-idempotent requests
        if (!isIdempotent) {
          throw error;
        }

        // Only retry on retryable status codes or network errors
        const isRetryable =
          !status || retryConfig.retryableStatuses.includes(status);

        if (!isRetryable || attempt === retryConfig.maxRetries) {
          throw error;
        }

        // Exponential backoff with full jitter
        const exponentialDelay = retryConfig.baseDelayMs * Math.pow(2, attempt);
        const cappedDelay = Math.min(exponentialDelay, retryConfig.maxDelayMs);
        const jitteredDelay = Math.random() * cappedDelay;

        this.logger.warn(
          `Request to ${config.url} failed (status=${status}, attempt=${attempt + 1}/${retryConfig.maxRetries}). ` +
            `Retrying in ${Math.round(jitteredDelay)}ms`,
        );

        await this.sleep(jitteredDelay);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### 8.2 Circuit Breakers

External dependencies are wrapped in circuit breakers using [opossum](https://github.com/nodeshift/opossum). When a dependency starts failing, the circuit opens and returns a fast error instead of accumulating timeouts.

```typescript
// apps/api/src/shared/resilience/circuit-breaker.factory.ts
import { Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';

export interface CircuitBreakerConfig {
  name: string;
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  rollingCountTimeout: number;
  rollingCountBuckets: number;
  volumeThreshold: number;
  halfOpenRequests: number;
}

const PRESETS: Record<string, Partial<CircuitBreakerConfig>> = {
  external: {
    timeout: 10_000,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
    volumeThreshold: 20,
    halfOpenRequests: 1,
  },
  feed: {
    timeout: 15_000,
    errorThresholdPercentage: 30,
    resetTimeout: 60_000,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
    volumeThreshold: 10,
    halfOpenRequests: 2,
  },
  internal: {
    timeout: 5_000,
    errorThresholdPercentage: 50,
    resetTimeout: 15_000,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
    volumeThreshold: 20,
    halfOpenRequests: 1,
  },
};

export function createCircuitBreaker<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: { name: string; preset: keyof typeof PRESETS } & Partial<CircuitBreakerConfig>,
): CircuitBreaker<TArgs, TResult> {
  const logger = new Logger(`CircuitBreaker:${config.name}`);
  const preset = PRESETS[config.preset] ?? PRESETS.external;
  const options = { ...preset, ...config };

  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeout,
    errorThresholdPercentage: options.errorThresholdPercentage,
    resetTimeout: options.resetTimeout,
    rollingCountTimeout: options.rollingCountTimeout,
    rollingCountBuckets: options.rollingCountBuckets,
    volumeThreshold: options.volumeThreshold,
    allowWarmUp: true,
    name: config.name,
  });

  breaker.on('open', () => {
    logger.warn(`Circuit OPEN for ${config.name} -- requests will fail fast`);
  });

  breaker.on('halfOpen', () => {
    logger.log(`Circuit HALF-OPEN for ${config.name} -- sending probe requests`);
  });

  breaker.on('close', () => {
    logger.log(`Circuit CLOSED for ${config.name} -- normal operation resumed`);
  });

  breaker.on('fallback', () => {
    logger.debug(`Fallback invoked for ${config.name}`);
  });

  return breaker;
}
```

**Usage example (SMS Gateway):**

```typescript
// apps/api/src/modules/notification/services/sms.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { createCircuitBreaker } from '../../../shared/resilience/circuit-breaker.factory';
import { ResilientHttpService } from '../../../shared/http/resilient-http.service';
import { DependencyUnavailableError } from '../../../shared/errors';

@Injectable()
export class SmsService implements OnModuleInit {
  private sendBreaker: CircuitBreaker<[string, string], void>;

  constructor(private readonly http: ResilientHttpService) {}

  onModuleInit() {
    this.sendBreaker = createCircuitBreaker(
      (to: string, body: string) => this.doSend(to, body),
      { name: 'sms-gateway', preset: 'external' },
    );

    // Fallback: queue for later delivery
    this.sendBreaker.fallback(async (to: string, body: string) => {
      throw new DependencyUnavailableError(
        'SMS gateway is currently unavailable. Message queued for retry.',
      );
    });
  }

  async send(to: string, body: string): Promise<void> {
    await this.sendBreaker.fire(to, body);
  }

  private async doSend(to: string, body: string): Promise<void> {
    await this.http.request({
      method: 'POST',
      url: process.env.SMS_GATEWAY_URL,
      data: { to, body },
      idempotent: true,
      retry: { maxRetries: 3 },
    });
  }
}
```

**Circuit breaker configuration per dependency:**

| Dependency | Preset | Failure Threshold | Volume Threshold | Reset Timeout | Half-Open Probes |
|---|---|---|---|---|---|
| SMS Gateway | `external` | 50% | 20 requests | 30s | 1 |
| Email Service | `external` | 50% | 20 requests | 30s | 1 |
| Weather API | `feed` | 30% | 10 requests | 60s | 2 |
| Seismic Feed | `feed` | 30% | 10 requests | 60s | 2 |
| CAP Feed | `feed` | 30% | 10 requests | 60s | 2 |
| OpenSearch | `internal` | 50% | 20 requests | 15s | 1 |

### 8.3 Bulkheads

Bulkhead isolation prevents a single failing dependency from consuming all resources and cascading to other parts of the system.

**Process-level isolation:**

- `api`, `realtime`, `workers`, and `sfu` each run in separate Kubernetes pods (separate processes)
- Within `workers`, each processor type runs in a dedicated NATS consumer group, so a stuck OCR job cannot block notification delivery

**Database connection pool isolation:**

```typescript
// apps/api/src/shared/database/pool-config.ts
export const POOL_CONFIG = {
  // Per-module pools within the API
  api: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statementTimeout: 3_000,
  },

  // Workers use a smaller pool
  workers: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
    statementTimeout: 30_000,    // Workers run longer queries (ETL)
  },

  // Realtime gateway needs minimal DB access
  realtime: {
    max: 5,
    min: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
    statementTimeout: 2_000,
  },
} as const;
```

**Redis connection pool isolation:**

```typescript
// apps/api/src/shared/cache/redis-pools.ts
import { Redis } from 'ioredis';

// Separate Redis connections for different purposes
// prevents pub/sub blocking from affecting cache reads

export function createCacheRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0,
    maxRetriesPerRequest: 3,
    connectTimeout: 5_000,
    commandTimeout: 500,
    lazyConnect: true,
    keyPrefix: 'cache:',
  });
}

export function createPubSubRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0,
    maxRetriesPerRequest: null,   // pub/sub should retry indefinitely
    connectTimeout: 5_000,
    lazyConnect: true,
  });
}

export function createSessionRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: 1,                         // Separate DB for session isolation
    maxRetriesPerRequest: 3,
    connectTimeout: 5_000,
    commandTimeout: 1_000,
    lazyConnect: true,
    keyPrefix: 'sess:',
  });
}
```

**Fast-fail on exhaustion:**

When connection pools are exhausted, the system returns 503 immediately rather than queuing requests:

```typescript
// apps/api/src/shared/database/pool-guard.middleware.ts
import { Injectable, NestMiddleware, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class PoolGuardMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  use(req: Request, res: Response, next: NextFunction) {
    const pool = (this.dataSource.driver as any).master;
    const waiting = pool.waitingCount ?? 0;
    const maxWaiting = 10;

    if (waiting >= maxWaiting) {
      throw new ServiceUnavailableException(
        'Database connection pool exhausted. Please retry shortly.',
      );
    }

    next();
  }
}
```

### 8.4 Graceful Degradation Matrix

| Failure | Detection | Degraded Behavior | User-Visible Impact | Recovery |
|---|---|---|---|---|
| **OpenSearch down** | Health check fails, circuit breaker opens | Search falls back to PostgreSQL `pg_trgm` full-text search | Slower search, fewer features (no fuzzy, no facets). Banner: "Search running in limited mode" | Auto-recover when OpenSearch healthy. NATS backlog replayed to re-index missed writes |
| **NATS down** | Health check fails, publish timeout | Outbox table accumulates events. Modules continue operating via direct DB reads | "Sync paused" banner. Real-time updates delayed. Cross-module events queued | Outbox relay flushes accumulated events on NATS recovery |
| **MinIO down** | Health check fails, circuit breaker opens | File uploads queued client-side with retry. Existing file URLs return 503 | "File uploads temporarily unavailable" banner. Cached thumbnails still work | Auto-recover. Client retries queued uploads |
| **Realtime gateway down** | Health check, WebSocket disconnect | Frontend auto-falls back to 5-second REST polling | "Live updates paused" indicator. Slightly delayed updates | Auto-reconnect with exponential backoff. Full state resync on reconnect |
| **DB read replica down** | Health check, connection error | Reads route to remaining replicas. If all replicas down, reads go to primary | No user impact unless all replicas fail | Automatic failover to healthy replicas |
| **Primary DB down** | Health check, connection refused | Promote standby to primary (max 60s). Write operations fail during promotion | "System temporarily read-only" for up to 60s | Manual failback after investigation. Replication re-established |
| **Redis down** | Health check, connection timeout | PDP (policy decision point) falls back to direct DB queries. No caching | Slightly slower responses. Sessions validated against DB | Auto-recover. Cache warms organically |
| **SFU down** | Health check, signaling disconnect | Active calls terminated. New calls unavailable | "Voice/video unavailable" banner. Chat remains functional | Auto-recover. Users must re-initiate calls |

### 8.5 Timeout Budget

Every layer in the request path has a strict timeout. The total budget is structured so that inner timeouts expire before outer timeouts, ensuring proper error propagation.

```
Client (browser)
  |
  | 30s timeout (fetch/axios)
  v
Edge / Ingress (Nginx)
  |
  | proxy_read_timeout: 30s
  v
Web BFF (Next.js SSR)
  |
  | 5s per upstream API call (Promise.allSettled with individual timeouts)
  v
API
  |--- DB query: 3s (statement_timeout)
  |--- Redis: 500ms (commandTimeout, cache miss = skip)
  |--- NATS publish: 1s (ack timeout, fallback to outbox)
  |--- OpenSearch: 3s (requestTimeout)
  |--- External API: 10s (circuit breaker wraps)
  v
Response
```

| Layer | Timeout | Fallback |
|---|---|---|
| Browser to Edge | 30s | Show error page / retry button |
| Edge (Nginx) to BFF | 30s (`proxy_read_timeout`) | 504 Gateway Timeout |
| BFF to API | 5s per call | `Promise.allSettled` -- partial page render |
| API to PostgreSQL | 3s (`statement_timeout`) | 503 with retry hint |
| API to Redis | 500ms (`commandTimeout`) | Skip cache, proceed without |
| API to NATS | 1s (publish ack) | Write to outbox table |
| API to OpenSearch | 3s | Fall back to `pg_trgm` search |
| API to External Integration | 10s | Circuit breaker opens, fallback response |
| WebSocket heartbeat | 25s interval, 60s timeout | Client reconnects automatically |
| Kubernetes liveness probe | 3s timeout, 3 failures | Pod killed and restarted |
| Kubernetes readiness probe | 3s timeout, 2 failures | Pod removed from service endpoints |

---

## 9. Disaster Recovery

### 9.1 Backup Strategy

| Component | Method | Frequency | Retention | Storage Location |
|---|---|---|---|---|
| PostgreSQL | WAL-G streaming + base backup (pg_basebackup) | WAL: continuous. Base: every 6 hours | 30 days local, 90 days off-site | Primary storage + DR site (S3-compatible) |
| Redis | RDB snapshots + AOF append-only file | RDB: every 1 hour. AOF: continuous | 7 days | Same node + backup volume |
| MinIO | Erasure coding (built-in) + cross-site replication | Continuous (built-in) | Indefinite (policy-based lifecycle) | Primary site + DR site |
| NATS JetStream | File-based storage with replication | Continuous (built into JetStream) | 7 days per stream (configurable) | Local fast-ssd volume |
| OpenSearch | Snapshot to S3-compatible | Daily at 02:00 UTC | 30 days | S3-compatible (MinIO bucket) |
| Helm values + secrets | Git (values) + Vault backup (secrets) | On every change | Indefinite | Off-site Git repo + Vault DR |
| Kubernetes state | Velero backup (etcd + PVs) | Daily | 30 days | S3-compatible |

**PostgreSQL backup configuration (WAL-G):**

```yaml
# charts/postgres/templates/backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: coescd-postgres-backup
  namespace: sentinel
spec:
  schedule: "0 */6 * * *"      # Every 6 hours
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: wal-g/wal-g:latest
              command:
                - /bin/sh
                - -c
                - |
                  wal-g backup-push /var/lib/postgresql/data
                  wal-g delete retain FULL 20 --confirm
              env:
                - name: PGHOST
                  value: coescd-postgres
                - name: PGUSER
                  valueFrom:
                    secretKeyRef:
                      name: coescd-db-credentials
                      key: username
                - name: PGPASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: coescd-db-credentials
                      key: password
                - name: WALG_S3_PREFIX
                  value: s3://coescd-backups/postgres/
                - name: AWS_ENDPOINT
                  value: http://coescd-minio:9000
                - name: AWS_ACCESS_KEY_ID
                  valueFrom:
                    secretKeyRef:
                      name: coescd-minio-credentials
                      key: access-key
                - name: AWS_SECRET_ACCESS_KEY
                  valueFrom:
                    secretKeyRef:
                      name: coescd-minio-credentials
                      key: secret-key
                - name: AWS_S3_FORCE_PATH_STYLE
                  value: "true"
```

### 9.2 RPO / RTO Targets

| Metric | Target | How Achieved |
|---|---|---|
| **RPO** (Recovery Point Objective) | <= 60 seconds | Continuous WAL streaming to standby. Asynchronous replication lag measured and alerted if > 30s |
| **RTO** (Recovery Time Objective) | <= 15 minutes | Automated standby promotion (Patroni or manual). Pre-configured DNS/LB failover. Health verification script |

**Monitoring replication lag:**

```yaml
# Prometheus alert rule
groups:
  - name: coescd-dr
    rules:
      - alert: PostgresReplicationLagHigh
        expr: pg_replication_lag_seconds > 30
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL replication lag is {{ $value }}s (threshold: 30s)"

      - alert: PostgresReplicationLagCritical
        expr: pg_replication_lag_seconds > 60
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL replication lag exceeds RPO target ({{ $value }}s > 60s)"
```

### 9.3 DR Site Architecture

```
Primary Site                              DR Site (Warm Standby)
=============                             ======================

K8s Cluster                               K8s Cluster (scaled down)
  |- api (3 pods)                           |- api (1 pod, standby)
  |- realtime (3 pods)                      |- realtime (1 pod, standby)
  |- workers (2 pods)                       |- workers (1 pod, standby)
  |- web (2 pods)                           |- web (1 pod, standby)
  |                                         |
  |- PostgreSQL primary ----WAL stream----> |- PostgreSQL standby (hot standby, read-only)
  |- Redis primary --------replication----> |- Redis replica (CoESCD-managed)
  |- MinIO (4 nodes) -----replication----> |- MinIO (4 nodes, cross-site replication)
  |- NATS (3 nodes)                         |- NATS (3 nodes, independent cluster)
  |- OpenSearch (3 nodes)                   |- OpenSearch (restore from snapshot)

DNS: coescd.gov.xx -> Primary LB IP
     (manual or health-check failover to DR LB IP)
```

**Key design decisions:**

- PostgreSQL: streaming replication (async by default, synchronous optional for zero-RPO at the cost of write latency)
- Redis: CoESCD-managed replication. DR Redis becomes primary on failover
- MinIO: native cross-site replication ensures all objects are present at DR site
- NATS: separate cluster at DR site. Events are replayed from the outbox table after failover (NATS streams are not cross-replicated)
- OpenSearch: restored from daily snapshot. Acceptable data lag for search indexes (re-indexing from DB fills the gap)

### 9.4 Failover Procedure

**Automated detection:**

```yaml
# Prometheus alert triggers PagerDuty
- alert: PrimarySiteDown
  expr: up{job="coescd-api", site="primary"} == 0
  for: 3m
  labels:
    severity: critical
    pagerduty: true
  annotations:
    summary: "Primary site unreachable for 3 minutes"
    runbook: "https://docs.internal/sentinel/runbooks/dr-failover"
```

**Manual failover steps:**

```bash
#!/usr/bin/env bash
# tools/scripts/dr-failover.sh
# Run from DR site management node

set -euo pipefail

echo "=========================================="
echo "  COESCD DR FAILOVER PROCEDURE"
echo "=========================================="
echo ""

# Step 1: Verify primary is actually down (prevent split-brain)
echo "[1/10] Verifying primary site failure..."
for endpoint in api.primary.internal realtime.primary.internal; do
  if curl -sf "https://${endpoint}/healthz" --connect-timeout 5 2>/dev/null; then
    echo "WARNING: ${endpoint} is reachable. Aborting to prevent split-brain."
    echo "If primary is partially up, investigate before proceeding."
    exit 1
  fi
done
echo "  Primary confirmed unreachable."

# Step 2: Verify from multiple vantage points
echo "[2/10] Cross-checking from secondary monitoring..."
SECONDARY_CHECK=$(curl -sf "https://monitor.secondary.internal/api/v1/query?query=up{job='coescd-api',site='primary'}" | jq -r '.data.result[0].value[1]')
if [ "$SECONDARY_CHECK" = "1" ]; then
  echo "WARNING: Secondary monitor sees primary as UP. Possible network partition."
  exit 1
fi
echo "  Secondary monitor confirms primary is down."

# Step 3: Promote PostgreSQL standby
echo "[3/10] Promoting PostgreSQL standby to primary..."
kubectl exec -n sentinel coescd-postgres-0 -- \
  pg_ctl promote -D /var/lib/postgresql/data
echo "  Waiting for promotion..."
sleep 5
kubectl exec -n sentinel coescd-postgres-0 -- \
  psql -U postgres -c "SELECT pg_is_in_recovery();" | grep -q "f" || {
    echo "ERROR: PostgreSQL promotion failed"
    exit 1
  }
echo "  PostgreSQL promoted successfully."

# Step 4: Update Redis CoESCD
echo "[4/10] Triggering Redis CoESCD failover..."
kubectl exec -n sentinel coescd-redis-coescd-0 -- \
  redis-cli -p 26379 COESCD FAILOVER coescd-master
sleep 3
echo "  Redis failover initiated."

# Step 5: Scale up DR application pods
echo "[5/10] Scaling up DR application pods..."
kubectl scale deployment -n sentinel coescd-api --replicas=3
kubectl scale deployment -n sentinel coescd-realtime --replicas=3
kubectl scale deployment -n sentinel coescd-workers --replicas=2
kubectl scale deployment -n sentinel coescd-web --replicas=2
kubectl scale deployment -n sentinel coescd-sfu --replicas=2

echo "  Waiting for pods to be ready..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/part-of=sentinel \
  -n sentinel --timeout=300s
echo "  All pods ready."

# Step 6: Redirect ingress
echo "[6/10] Updating DNS to point to DR site..."
echo "  ACTION REQUIRED: Update DNS record for coescd.gov.xx to DR LB IP"
echo "  DR LB IP: $(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
read -rp "  Press Enter after DNS update is propagated..."

# Step 7: Verify health probes
echo "[7/10] Verifying health probes..."
DR_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -sf "http://${DR_IP}/api/healthz" || { echo "Health check failed"; exit 1; }
curl -sf "http://${DR_IP}/api/readyz" || { echo "Readiness check failed"; exit 1; }
echo "  Health probes passing."

# Step 8: Replay outbox events
echo "[8/10] Flushing outbox to NATS..."
kubectl exec -n sentinel deployment/coescd-api -- \
  node dist/cli.js outbox:flush --since="1h"
echo "  Outbox flushed."

# Step 9: Notify operators
echo "[9/10] Sending notifications..."
curl -X POST "${SLACK_WEBHOOK}" \
  -H 'Content-Type: application/json' \
  -d '{"text":"COESCD DR FAILOVER COMPLETE. DR site is now primary. Investigate original failure."}'
echo "  Notifications sent."

# Step 10: Begin monitoring
echo "[10/10] Failover complete."
echo ""
echo "  POST-FAILOVER CHECKLIST:"
echo "  [ ] Monitor error rate for 30 minutes"
echo "  [ ] Verify all user-facing features work"
echo "  [ ] Check replication lag (should be 0 now)"
echo "  [ ] Schedule post-mortem within 24 hours"
echo "  [ ] Plan failback procedure"
echo ""
echo "=========================================="
echo "  FAILOVER COMPLETE -- $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
```

### 9.5 DR Drills

**Quarterly full failover drill:**

| Week | Activity | Duration | Personnel |
|---|---|---|---|
| Week 1 | Pre-drill checklist: verify DR replication, review runbook | 2 hours | SRE lead |
| Week 2 | Full failover drill: execute DR procedure end-to-end | 4 hours | SRE team + incident commander |
| Week 2 | Measure: RPO achieved, RTO achieved, issues encountered | 1 hour | SRE team |
| Week 3 | Failback: restore primary site, re-establish replication | 4 hours | SRE team |
| Week 3 | Drill report: file as post-incident report in CoESCD | 2 hours | SRE lead |

**Monthly chaos engineering:**

| Test | Method | Expected Outcome | SLO Threshold |
|---|---|---|---|
| Kill random API pods | `kubectl delete pod` | HPA replaces, zero downtime | Error rate < 0.1% |
| Partition NATS from API | NetworkPolicy update | Outbox accumulates, banner shown | No data loss, events delivered after recovery |
| Throttle DB to 100ms latency | tc netem on data nodes | Slower responses, no errors | p99 < 5s, error rate < 1% |
| Kill Redis | `kubectl delete pod` | Cache miss, PDP falls back to DB | p99 < 3s during recovery |
| Fill MinIO disk to 95% | Write test data | Alert fires, uploads rejected gracefully | Upload error shown to user, no crash |
| Simulate DNS failure | Override CoreDNS config | Service discovery recovers via cached entries | Recovers within 30s |

---

## 10. Scaling Strategy

### 10.1 Horizontal Scaling Targets

| Component | Scaling Metric | Trigger Threshold | Min Pods | Max Pods | Notes |
|---|---|---|---|---|---|
| API | CPU utilization | > 70% sustained 60s | 3 | 20 | Stateless, scales freely |
| Realtime | WebSocket connections/pod | > 40,000 | 3 | 30 | Sticky sessions via Redis adapter |
| Workers | NATS consumer pending msgs | > 1,000 events behind | 2 | 15 | Stateless, NATS consumer groups |
| SFU | Active media calls/pod | > 50 | 2 | 10 | CPU-bound (VP8/VP9 forwarding) |
| Web | CPU utilization | > 70% sustained 60s | 2 | 10 | Stateless, SSR compute |

**Scaling behavior tuning:**

```yaml
# Scale-up: aggressive (respond to load spikes quickly)
scaleUp:
  stabilizationWindowSeconds: 60    # Wait 60s before scaling up
  policies:
    - type: Pods
      value: 2                       # Add up to 2 pods per minute
      periodSeconds: 60

# Scale-down: conservative (avoid flapping)
scaleDown:
  stabilizationWindowSeconds: 300    # Wait 5min of low load before scaling down
  policies:
    - type: Pods
      value: 1                       # Remove 1 pod per 2 minutes
      periodSeconds: 120
```

### 10.2 Database Scaling

**PostgreSQL topology:**

```
                      PgBouncer (transaction mode)
                      max_client_conn=500
                      default_pool_size=20
                           |
              ┌────────────┼────────────┐
              v            v            v
         Primary      Replica 1    Replica 2
         (writes)     (reads)      (analytics)
              |
              |--- WAL streaming ──> Replica 1
              |--- WAL streaming ──> Replica 2
              |--- WAL archiving ──> S3 (MinIO)
```

**PgBouncer configuration:**

```ini
; pgbouncer.ini
[databases]
sentinel_rw = host=coescd-postgres-primary port=5432 dbname=sentinel
sentinel_ro = host=coescd-postgres-replicas port=5432 dbname=sentinel

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction
max_client_conn = 500
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3

server_idle_timeout = 300
client_idle_timeout = 300
query_timeout = 30
query_wait_timeout = 10

log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
stats_period = 60
```

**Read/write splitting in the application:**

```typescript
// apps/api/src/shared/database/read-write.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const READ_ONLY_KEY = 'DATABASE_READ_ONLY';

/**
 * Decorator to mark a query as read-only.
 * The query interceptor routes these to read replicas.
 */
export const ReadOnly = () => SetMetadata(READ_ONLY_KEY, true);

// Usage in a service:
// @ReadOnly()
// async findIncidents(filter: IncidentFilter): Promise<Incident[]> { ... }
```

**Table partitioning strategy:**

```sql
-- Partition timeline events by month (managed by pg_partman)
CREATE TABLE comms.messages (
    id          UUID DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL,
    sender_id   UUID NOT NULL,
    content     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- pg_partman manages partition creation/retention
SELECT partman.create_parent(
    p_parent_table := 'comms.messages',
    p_control := 'created_at',
    p_type := 'native',
    p_interval := '1 month',
    p_premake := 3,           -- Create 3 months ahead
    p_start_partition := '2026-01-01'
);

-- Similar partitioning for:
-- incident.timeline_events (monthly)
-- notification.deliveries (monthly)
-- analytics.audit_events (monthly)
```

### 10.3 Redis Scaling

**Single-instance deployment** (sufficient for most deployments):

Redis 7 on a dedicated node handles 100K+ ops/sec. A single instance with 16GB RAM supports:

- ~5 million cached entries (average 1KB each)
- ~100K active sessions
- pub/sub for all realtime gateway pods
- Policy decision cache for RBAC

**Large-scale deployment** (Redis Cluster):

```
Redis Cluster (6 nodes)
  Primary 1 (slots 0-5460)     ──> Replica 1
  Primary 2 (slots 5461-10922) ──> Replica 2
  Primary 3 (slots 10923-16383)──> Replica 3
```

When to upgrade from single instance to cluster:

| Indicator | Single Instance Limit | Action |
|---|---|---|
| Memory usage | > 80% of available RAM (e.g., > 13GB of 16GB) | Scale to cluster |
| ops/sec | > 80K sustained | Scale to cluster |
| pub/sub throughput | > 500K messages/sec | Separate pub/sub instance |
| Latency p99 | > 5ms | Investigate before scaling |

### 10.4 NATS Scaling

**3-node NATS cluster:**

```yaml
# charts/nats/values.yaml
cluster:
  enabled: true
  replicas: 3

jetstream:
  enabled: true
  fileStorage:
    enabled: true
    storageClassName: standard-ssd
    size: 100Gi
  memoryStorage:
    enabled: true
    size: 1Gi

# Stream configuration
streams:
  coescd-events:
    subjects: ["coescd.>"]
    retention: limits
    maxAge: 168h          # 7 days
    maxBytes: 107374182400 # 100GB
    replicas: 3
    storage: file
    discard: old
```

**Consumer groups for worker scaling:**

```typescript
// apps/workers/src/main.ts
// Each worker pod joins the same consumer group.
// NATS distributes messages across pods automatically.

const js = nc.jetstream();

// Durable consumer group -- messages distributed across all worker pods
const consumer = await js.consumers.get('coescd-events', 'worker-notifications');
const messages = await consumer.consume({
  max_ack_pending: 100,
  ack_wait: 30_000,     // 30s to process before redelivery
});

for await (const msg of messages) {
  await processNotification(msg);
  msg.ack();
}
```

### 10.5 MinIO Scaling

**Minimum production deployment (4 nodes, erasure coding):**

```yaml
# charts/minio/values.yaml
mode: distributed
replicas: 4
drivesPerNode: 4          # 4 drives per node = 16 drives total
                           # Erasure coding: can lose 4 drives (25%) without data loss

resources:
  requests:
    cpu: 2000m
    memory: 8Gi
  limits:
    cpu: 4000m
    memory: 16Gi

persistence:
  enabled: true
  storageClass: bulk
  size: 2.5Ti              # Per drive = 10Ti per node = 40Ti total raw

lifecycle:
  rules:
    - id: expire-temp-uploads
      prefix: coescd-uploads/tmp/
      expiration:
        days: 7
    - id: transition-old-exports
      prefix: coescd-exports/
      transition:
        days: 90
        storageClass: COLD   # Tiering to cheaper storage
```

**Scaling MinIO:**

- Add a new server pool (4+ nodes) to increase capacity
- MinIO automatically rebalances across pools
- Never scale below the erasure coding minimum (4 nodes per pool)

### 10.6 Capacity Planning

**Formula-based capacity estimation:**

| Metric | Formula | Example: 5,000 concurrent users |
|---|---|---|
| API pods | `ceil(concurrent_users / 500)` | `ceil(5000 / 500)` = 10 pods |
| Realtime pods | `ceil(ws_connections / 40000)` | `ceil(5000 / 40000)` = 1 (min 3) |
| Worker pods | `ceil(events_per_sec / 2000)` | `ceil(10000 / 2000)` = 5 pods |
| SFU pods | `ceil(concurrent_calls / 50)` | `ceil(100 / 50)` = 2 pods |
| Web pods | `ceil(page_views_per_sec / 200)` | `ceil(500 / 200)` = 3 pods |
| DB connections | `(api_pods * 20) + (worker_pods * 10) + (realtime_pods * 5)` | `(10*20)+(5*10)+(3*5)` = 265 |
| PgBouncer max | `DB_connections * 1.5 + buffer` | 500 |
| Redis memory | `sessions * 1KB + cache_entries * avg_size` | `5000*1KB + 500K*0.5KB` = ~255MB |
| NATS storage | `events_per_day * avg_event_size * retention_days` | `500K * 1KB * 7` = ~3.5GB |
| MinIO storage | `files * avg_file_size` | Depends on document/image volume |

**Scaling tiers:**

| Tier | Concurrent Users | API Pods | DB Nodes | Worker Pods | Total CPU | Total RAM |
|---|---|---|---|---|---|---|
| Small | 500 | 3 | 1+1 replica | 2 | 48 vCPU | 96 GB |
| Medium | 5,000 | 10 | 1+2 replicas | 5 | 100 vCPU | 300 GB |
| Large | 25,000 | 20 | 1+3 replicas | 15 | 200 vCPU | 640 GB |
| National | 100,000+ | 20 (multiple clusters) | Sharded | 15+ per cluster | 500+ vCPU | 1.5+ TB |

For national-scale deployments exceeding 25,000 concurrent users, consider deploying multiple regional CoESCD clusters with cross-region data synchronization via PostgreSQL logical replication and MinIO cross-site replication. Each regional cluster handles its geography independently, with a central analytics cluster aggregating data for national dashboards.

---

## Appendix: Key Configuration Files Quick Reference

| File | Purpose |
|---|---|
| `infra/docker/docker-compose.yml` | Local dev infrastructure |
| `infra/docker/Dockerfile.*` | Per-app container builds |
| `infra/k8s/values.yaml` | Helm defaults |
| `infra/k8s/values-onprem.yaml` | On-prem overrides |
| `.github/workflows/ci.yml` | CI/CD pipeline |
| `.env.example` | Environment variable template |
| `tools/migrations/init.sql` | Database schema initialization |
| `tools/scripts/dr-failover.sh` | DR failover runbook script |
| `tools/scripts/mirror-images.sh` | Air-gap image mirroring |
| `packages/eslint-config/index.js` | Architectural boundary rules |
