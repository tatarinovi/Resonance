# Local Docker

This profile runs Resonance locally from source with PostgreSQL, MinIO, the FastAPI backend, the built frontend, and a Caddy gateway.

## Start

From the repository root:

```bash
docker compose -f deploy/local/docker-compose.local.yml --env-file deploy/local/.env.example up -d --build
```

Open:

- Application: http://localhost:8080
- Backend health: http://localhost:8000/health
- MinIO console: http://localhost:9001

Default login:

- Username: `admin`
- Password: `resonance-local-admin-password`

## Local Overrides

Create a private env file when you need real tokens or different ports:

```bash
cp deploy/local/.env.example deploy/local/.env.local
docker compose -f deploy/local/docker-compose.local.yml --env-file deploy/local/.env.local up -d --build
```

The `.env.local` file is intentionally ignored by git.

## Optional Bot

The Matrix bot is disabled by default so the local app can start without Matrix credentials. To run it:

```bash
docker compose -f deploy/local/docker-compose.local.yml --env-file deploy/local/.env.local --profile bot up -d --build
```

Fill `MATRIX_HOMESERVER`, `MATRIX_USER_ID`, and either `MATRIX_ACCESS_TOKEN` or password-related variables before enabling the bot.

## Stop And Reset

Stop services:

```bash
docker compose -f deploy/local/docker-compose.local.yml down
```

Remove local database and MinIO data:

```bash
docker compose -f deploy/local/docker-compose.local.yml down -v
```
