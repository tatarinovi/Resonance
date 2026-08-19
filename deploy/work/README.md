# Work-server Docker

A minimal source-based deployment for a local work server. It runs PostgreSQL, the FastAPI backend, and the frontend's existing Nginx image. Caddy, HTTPS, MinIO, and the bot are intentionally absent.

The application is served over HTTP by the frontend Nginx container; it proxies `/api` and `/api/stream` to the backend on the internal Docker network. Only the frontend host port is published. Attachments are unavailable because this profile has no S3-compatible storage.

## Start

1. Copy the defaults and set `SERVER_HOST` to the server IP. Change the default admin/database/JWT passwords before sharing access.

   ```bash
   cp deploy/work/.env.example deploy/work/.env.work
   ```

2. Build and start:

   ```bash
   docker compose -f deploy/work/docker-compose.work.yml --env-file deploy/work/.env.work up -d --build
   ```

3. Open `http://<SERVER_HOST>:8082`. The default `WORK_HTTP_PORT=8082` avoids the occupied ports `3307`, `4444`, `5057`, `8081`, and `8888`.

Default login: `admin` / `adminadmin`.

## Operations

```bash
# Status and application health
docker compose -f deploy/work/docker-compose.work.yml --env-file deploy/work/.env.work ps
curl -f http://<SERVER_HOST>:8082/health

# Stop containers, preserving PostgreSQL data
docker compose -f deploy/work/docker-compose.work.yml --env-file deploy/work/.env.work down

# Remove containers and the database volume
docker compose -f deploy/work/docker-compose.work.yml --env-file deploy/work/.env.work down -v
```

`deploy/work/.env.work` is ignored by Git.
