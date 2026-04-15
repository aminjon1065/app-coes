# app-coes

CoESCD workspace with NestJS backend, Next.js frontend, Dockerized infrastructure, and production-oriented reverse proxy / observability layers.

## Local dev

Start infrastructure:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

Optional observability profile:

```bash
docker compose -f infra/docker/docker-compose.yml --profile observability up -d
```

Run applications separately:

```bash
cd backend && npm run start:dev
cd frontend && npm run dev
```

## Production-style stack

Required before startup:

1. Create TLS files in `infra/docker/nginx/ssl/`
   - `cert.pem`
   - `key.pem`
2. Override default secrets with real values via environment variables or `.env`
   - `POSTGRES_PASSWORD`
   - `REDIS_PASSWORD`
   - `MINIO_ROOT_PASSWORD`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `COOKIE_SECRET`
   - `GRAFANA_ADMIN_PASSWORD`

Validate compose:

```bash
docker compose -f infra/docker/docker-compose.prod.yml config
docker compose -f infra/docker/docker-compose.prod.yml --profile observability config
```

Build and start:

```bash
docker compose -f infra/docker/docker-compose.prod.yml build
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

With observability:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --profile observability up -d
```

## Verification

Application build checks:

```bash
cd backend && npm run build
cd frontend && npm run build
```

Key endpoints after startup:

- app: `https://localhost`
- backend liveness: `https://localhost/health/live`
- frontend health: `https://localhost/api/health`
- prometheus: `http://localhost:9090`
- grafana: `http://localhost:3500`

## Notes

- `infra/docker/docker-compose.yml` is the dev infra stack.
- `infra/docker/docker-compose.prod.yml` is the production-style application stack.
- Observability log collection in the prod stack mounts `/var/lib/docker/containers`, so `promtail` is intended for Linux Docker hosts.
- Detailed deployment architecture is in `docs/architecture/deployment.md`.
