Place TLS assets in this directory before starting the production stack.

Required files:
- `cert.pem`
- `key.pem`

Expected usage:
```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

For local smoke tests you can generate a self-signed pair:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infra/docker/nginx/ssl/key.pem \
  -out infra/docker/nginx/ssl/cert.pem \
  -subj "/CN=localhost"
```
