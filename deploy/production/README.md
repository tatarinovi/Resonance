# Resonance Production Deployment

This package is for image-only deployment. The customer receives Docker images, `docker-compose.production.yml`, `.env.example`, and this README. Source code is not required on the production server.

## Architecture

- `gateway`: public HTTP/HTTPS entrypoint.
- `frontend`: static Vite build served by nginx, no Node.js runtime.
- `backend`: FastAPI API.
- `bot`: Matrix/digest worker from the same backend image.
- `migrate`: one-shot Alembic/bootstrap job.
- `db`: PostgreSQL.
- `minio`: default S3-compatible attachment storage.

Backend and bot intentionally use one image for the first production release. This keeps release handling simple. Split API and worker images later if scaling or a stricter security profile becomes necessary.

## Storage Choice

Default: keep MinIO for a self-contained office deployment.

Alternatives:
- Existing company S3: better durability and backup tooling, but requires customer networking and credentials.
- Local storage: not recommended right now because the application is S3-compatible, not local-storage-first.

If analytics and design rooms share the same Matrix room ID, configure the same room ID in the admin UI. The application should deduplicate messages at send time.

## Registry Login

Use GHCR or GitLab Container Registry owned by the project owner. The customer gets a read-only deploy token.

```bash
echo "<READ_ONLY_DEPLOY_TOKEN>" | docker login ghcr.io -u "<DEPLOY_USER>" --password-stdin
```

For GitLab registry, replace `ghcr.io` with the GitLab registry host.

## `.env.production` Ownership

`.env.production` is created and stored only on the customer production server. It is owned by the customer/operator responsible for the office deployment.

The project owner supplies `.env.example` and documents required variables, but does not receive customer production secrets unless separately agreed.

Recommended permissions:

```bash
chown root:docker .env.production
chmod 0640 .env.production
```

Never commit `.env.production`, copy it into images, archive it into release bundles, or send it through chat/email without an approved secure channel.

## Deploy

Run commands from the directory containing `docker-compose.production.yml` and `.env.production`.

Set the immutable version first:

```bash
export RESONANCE_VERSION=v1.2.3-a1b2c3d4
```

Pull images and start the database:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d db
```

Create a backup before migration:

```bash
mkdir -p backups
docker compose -f docker-compose.production.yml --env-file .env.production exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/resonance-before-${RESONANCE_VERSION}-$(date +%F-%H%M).sql"
```

Run the one-shot migration/bootstrap job:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production --profile tools run --rm migrate
```

Restart services:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --remove-orphans
docker compose -f docker-compose.production.yml --env-file .env.production ps
```

The daily operation command is:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production pull && \
docker compose -f docker-compose.production.yml --env-file .env.production up -d --remove-orphans
```

Use the full backup and migration sequence for version upgrades.

## Rollback

```bash
export RESONANCE_VERSION=v1.2.2-previoussha
docker compose -f docker-compose.production.yml --env-file .env.production pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d --remove-orphans
```

Application rollback is safe only with backward-compatible database migrations. If a migration is destructive, restore the pre-migration database backup first or follow migration-specific rollback steps.

## Operations

View logs:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production logs -f backend bot gateway
```

Back up PostgreSQL regularly with `pg_dump` or physical backups. Back up the `minio_data` volume as well if MinIO is used.

The production compose uses read-only filesystems for `backend`, `bot`, and `frontend`. If a future runtime feature needs disk writes, add a narrow `tmpfs` or named volume for that exact path. Do not add source-code bind mounts.

For internal office domains, configure DNS and TLS before rollout. If public ACME certificates are not possible, use the company's internal CA and adjust the gateway image/config in the release pipeline.
