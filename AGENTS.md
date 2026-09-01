# AGENTS.md — Resonance repository guide

This file is the operational source of truth for agents working in this repository. It applies to the entire tree. Keep it current when architecture, commands, routes, schema, or conventions change. The snapshot below was verified against commit `433a9ad` on 2026-08-31.

## What this product is

Resonance is an internal question-routing and team-knowledge application. It combines:

- questions/tickets with assignment, discussion, attachments, history, subscriptions, and controlled status transitions;
- projects, users, role- and project-scoped access;
- epics with QA plans, stages, blockers, test runs, comments, and release data;
- in-app, Matrix, and Telegram notifications plus digests/escalations;
- global Kanban, Jira and TestOps connections, with encrypted instance credentials; Kanban also backs cached analytics snapshots;
- a React single-page application behind Caddy.

The UI and much of the product copy are Russian. Preserve the language of the surrounding screen or API message.

## Repository map

```text
backend/
  app/
    main.py                  FastAPI app, middleware, startup, router registration
    bot.py                   Matrix/Telegram worker entry point
    config.py                pydantic-settings environment contract
    database.py              SQLAlchemy engine/session/Base
    models.py                all ORM models and persistent enums
    schemas.py               Pydantic request/response DTOs
    access_policy.py         central project/epic authorization rules
    routers/                 HTTP API grouped by domain
    domain_events/           event taxonomy/catalog
    *_service.py             domain, notification, escalation, and integration services
    scheduler.py             bot-side APScheduler jobs
    realtime.py              process-local SSE event bus
    kanban_client.py         external Kanban HTTP client and normalization
    storage.py               S3/MinIO access
  migrations/versions/       linear Alembic history; current head is 0018
  tests/                     pytest API/unit coverage
  docs/                      notification and Kanban implementation notes
frontend/
  src/
    main.tsx                 browser entry point
    App.tsx                  providers and React Router route table
    pages/                   route-level screens
    components/              feature, layout, shared, and shadcn-style UI components
    contexts/                auth, theme, notification, persona, DataBridge
    lib/api.ts               JWT-aware `/api` fetch wrapper
    lib/queries.ts           primary TanStack Query hooks and invalidation rules
    lib/kanban-ds/            Kanban DTOs, mapping, queries, templates
    lib/release-planning/     pure release-planning engine
    lib/router.tsx            wouter-compatible shim over react-router-dom
    lib/types.ts              frontend API DTO vocabulary
    data/                     legacy module-level arrays fed by DataBridge
    tests/                    Vitest/jsdom tests
    index.css                 Tailwind v4 import, tokens, light/dark themes
  public/                    static image assets
deploy/
  local/                     canonical source-based local Docker profile
  work/                      minimal HTTP work-server profile; no MinIO or bots
  production/                canonical image-only production profile/runbooks
  docker/                    production Dockerfiles and nginx config
.github/workflows/           CI, release build/scan/SBOM/sign workflows
helps/                       screenshots and legacy/reference product data
```

All supported deployment assets live under `deploy/`: use `deploy/local/*` for full development, `deploy/work/*` for the minimal work server, and `deploy/production/*` plus `deploy/docker/*` for releases. Do not recreate root-level compose/Caddy/Dockerfile variants; they were removed as an unused, divergent deployment path.

## Runtime architecture and request flow

```text
Browser -> Caddy gateway (:8080 local)
  /api/*   -> FastAPI (:8000)
  /files/* -> MinIO bucket `attachments`
  other    -> nginx-served React SPA

FastAPI -> PostgreSQL
FastAPI -> external Kanban API
FastAPI -> process-local SSE bus -> authenticated browser stream

bot process -> same PostgreSQL
            -> Matrix sync/client and Telegram bot
            -> APScheduler: digests, outbound delivery, escalation,
               retention, SLA warnings, Kanban snapshot refresh
```

`backend/app/main.py` also runs a 15-second legacy Kanban task poll loop so its publications reach the same in-memory SSE bus. The bus is not Redis-backed. Keep production at one API worker (`BACKEND_WORKERS=1`) unless realtime is redesigned; multiple workers split subscribers and events.

At API startup, `bootstrap_database()` runs Alembic and idempotent seeds only when `RUN_MIGRATIONS_ON_STARTUP=true`. Production intentionally disables this and runs `python -m app.migrate` through the `migrate` tools-profile service before application rollout. The bot must never run migrations.

## Canonical commands

Run commands from the repository root unless a `cd` is shown.

### Full local stack

```bash
docker compose \
  -f deploy/local/docker-compose.local.yml \
  --env-file deploy/local/.env.example \
  up -d --build
```

Endpoints: application `http://localhost:8080`, API health `http://localhost:8000/health`, API docs `http://localhost:8000/api/docs`, MinIO console `http://localhost:9001`, PostgreSQL host port `5434`.

Default local login is `admin` / `adminadmin`. To use private values, copy `deploy/local/.env.example` to ignored `deploy/local/.env.local` and pass that file. Enable the bot only when credentials are configured:

```bash
docker compose -f deploy/local/docker-compose.local.yml --env-file deploy/local/.env.local --profile bot up -d --build
```

Stop without data loss with `docker compose -f deploy/local/docker-compose.local.yml down`. `down -v` deletes PostgreSQL and MinIO data and is destructive.

### Minimal work server

`deploy/work/docker-compose.work.yml` runs PostgreSQL, backend, and the existing frontend nginx image on `${WORK_HTTP_PORT:-8082}`. Its nginx config proxies API/SSE directly, so there is no Caddy or HTTPS. MinIO, attachments, Matrix/Telegram bots, and public backend/database ports are intentionally absent. Follow `deploy/work/README.md`; copy its example env to ignored `.env.work` before shared use.

### Backend

Python target is 3.11.

```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest
```

Useful focused runs:

```bash
cd backend
python -m pytest tests/test_ticket_transitions.py -q
python -m pytest tests/test_notifications_feedback.py -q
python -m pytest tests/test_kanban_epic_charts.py -q
python -m pytest tests/test_alembic.py -q
```

Tests use an in-memory SQLite database, dependency overrides, and a mocked storage layer from `backend/tests/conftest.py`; they do not require PostgreSQL or MinIO. There is currently no configured backend lint/format command, so follow the existing Python style and rely on tests plus careful review.

### Frontend

Node must be at least 20; CI and production use 20.19.

```bash
cd frontend
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Vite serves on `:5173` and proxies `/api` to `http://localhost:8000`. Tests use Vitest, jsdom, and `src/tests/setupTests.ts`. Use a focused run such as `npm run test:run -- src/tests/questionViews.test.ts` while iterating.

### CI-equivalent gate

Before handing off a broad change, run backend pytest and all four frontend checks: typecheck, lint, test, build. Deployment changes should additionally pass:

```bash
ENV_FILE=.env.example docker compose \
  -f deploy/production/docker-compose.production.yml \
  --env-file deploy/production/.env.example \
  config >/dev/null
```

## Configuration and secrets

`backend/app/config.py` is the authoritative settings list. Pydantic reads environment variables case-insensitively and may read a working-directory `.env`. Important groups:

- app/database: `FRONTEND_URL`, `DATABASE_URL`, `CORS_ORIGINS`, `RUN_MIGRATIONS_ON_STARTUP`;
- auth: `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, default-admin credentials;
- Matrix/Telegram: homeserver/user/token/device/password, enable flags, proxy/name;
- storage: S3 endpoint/access/secret/bucket/public URL/upload limit;
- integrations: `INTEGRATION_CREDENTIALS_FERNET_KEY` is mandatory and must be a ready Fernet key; `INTEGRATION_CONNECTION_CHECK_TIMEOUT_SECONDS` controls connection checks. `EPIC_JIRA_REFRESH_TIMEOUT_SECONDS`, `EPIC_JIRA_PAGE_SIZE` and `EPIC_JIRA_MAX_ISSUES` bound manual Epic task refreshes. Credentials live only in `integration_connections`, never in user records or responses.

`JWT_SECRET` is mandatory, rejects common placeholders, and must be at least 16 characters. Never print or copy values from the root `.env`; it is a real ignored local file. Do not commit `.env`, `.env.local`, `.env.production`, tokens, generated credentials, database dumps, or MinIO data. Example env files must contain non-production placeholders only.

## Backend design

### API surface

All application routes are under `/api`; `/health` is outside the prefix.

| Router | Main endpoints and responsibility |
| --- | --- |
| `auth.py` | login, registration, current profile/settings, Kanban connection, Telegram link |
| `admin.py` | user/project CRUD and global routing settings; admin-only |
| `dashboard.py` | project/directory lookup and the full ticket lifecycle, messages, attachments |
| `epics.py` | epic CRUD, comments, QA block, QA transitions, history, blockers, test runs |
| `releases.py` | Release CRUD/lifecycle, Epic membership, read models, and explicit Jira/TestOps refresh |
| `feedback.py` | user feedback and admin moderation |
| `files.py` | S3 upload and cleanup |
| `analytics.py` | Kanban snapshot bootstrap/refresh/lists/detail/charts/daily summary |
| `kanban.py` | live Kanban projects, bundles, task/comments/work/checklist proxy |
| `notifications.py` | inbox/read/acknowledge and delivery health |
| `activity.py` | activity feed and role summary |
| `aggregates.py` | dashboard/profile/statistics aggregates |
| `reference.py` | enum/reference payload used by the UI |
| `stream.py` | authenticated SSE stream |

Do not put business rules in `main.py`. Routers orchestrate validation, authorization, transactions, events, and services; cross-route logic belongs in a focused service module.

### Identity, roles, and access

Persistent roles are `admin`, `coordinator`, `manager`, `employee`, and `expert`. `manager` is intentionally treated as coordinator by `is_coordinator_role()`. Workspaces are `ds` and `nota`; the frontend hides or changes some experiences for Nota users.

- Admins have global access; `AccessPolicy.get_allowed_project_ids(admin)` returns an empty list as the sentinel for unrestricted access.
- Other users see only assigned projects.
- Coordinators/managers on a project can manage epics; project members can view them and edit notes/comments where allowed.
- QA test-plan edits are allowed only in `draft`; execution updates only in `in_testing` or `blocked`; QA status transitions require coordinator/manager/admin.
- Reuse `get_current_user`, `require_admin`, `require_coordinator_or_admin`, and `AccessPolicy`. Do not duplicate ad-hoc role checks without a domain-specific reason.

Registration creates a pending user when approval is required. JWT subject is the username, the browser token lives at `localStorage["resonance.auth.token"]`, and an API 401 clears it and redirects to `/login`.

### Core persistence model

`models.py` is the canonical ORM schema; `schemas.py` is the public DTO contract. Major aggregates:

- `User` <-> `Project` is many-to-many through `user_projects`.
- `Ticket` belongs to a project and optionally an epic, author, and assignee; it owns messages, attachments, events, and subscribers.
- `Epic` belongs to a project and owns one QA block plus comments, audit records, blockers, test runs, and linked tickets.
- `Release` belongs to one project and aggregates historical Epic memberships; external Jira/TestOps/Questions/Kanban data remains Epic-owned.
- Notification persistence is split among user-facing `Notification`, outbound jobs/attempts, preferences/policies, fanout state, digest runs, operation contexts, and domain-event logs.
- `KanbanLegacyTaskSeen` is the per-user deduplication baseline for polling.
- `AppSetting` stores global JSON-ish configuration; `TelegramLinkingToken` supports account linking.

Use timezone helpers from `datetime_util.py` rather than inventing mixed aware/naive conversions. Existing DB timestamps are mostly UTC-naive and serialized consistently by the schemas.

### Ticket state machine

Statuses: `pending_approval`, `forwarded`, `returned`, `answered`, `closed`, `cancelled`.

The authoritative transition/actor logic is `_can_transition_status()` in `routers/dashboard.py`; the frontend consumes `/tickets/{id}/allowed-status-transitions`. Key flow is pending -> forwarded -> answered -> closed, with returned/cancelled/reopen branches. Only an assigned expert, coordinator, or admin can answer a forwarded ticket. Author/coordinator/admin can edit question text; coordinator/admin control priority, SLA, due date, and epic. Admin alone can delete. Always update the event/audit, notification, realtime, subscriber, and query-invalidation behavior when changing lifecycle rules—not just the status assignment.

### Epic QA state machine

Epic statuses are `new`, `in-progress`, `released`. QA statuses are `draft`, `in_testing`, `blocked`, `test_complete`, `stage_complete`, `prod_complete`, `closed`; stages are `test`, `stage`, `prod`.

Transitions are enforced in `_transition_qa_status()` in `routers/epics.py`. Completing a stage requires an active test cycle and all test-plan checkboxes; closing requires `prod_complete`. There can be only one test run per environment. Preserve audit writes and QA notifications when modifying this flow.

### Events, notifications, and realtime

An HTTP request gets an `X-Correlation-ID` (accepted only in a safe format, otherwise generated) from `CorrelationMiddleware`. Mutating flows should retain this correlation through `OperationContext`, `DomainEventLog`, notifications, and outbound jobs.

The usual path is:

```text
domain mutation
  -> ticket/epic audit event
  -> catalogued domain event
  -> NotificationService creates durable in-app notifications
  -> routing/policy queues idempotent Matrix/Telegram outbound jobs
  -> publish_event/publish_broadcast wakes relevant SSE clients
```

Use the domain event catalog in `domain_events/catalog.py`, `NotificationService`, routing helpers, and idempotency-key builders. Do not send external messages inline from an API request. `scheduler.py` drains pending jobs every 45 seconds and records delivery attempts. Consult `backend/docs/notification_digest_spec.md` before changing digest/routing semantics.

### Kanban integration

There are three related paths:

1. `kanban_client.py` is the HTTP adapter and normalization boundary.
2. `routers/kanban.py` exposes live project/task operations and a cached project bundle for the board UI.
3. `routers/analytics.py` serves an application-level snapshot for analytics/release screens; snapshot refresh is explicit and scheduled daily.

Kanban credentials are global and administrator-managed through `GET/PATCH/POST/DELETE /api/integrations`; Jira and TestOps currently support setup and connection checks only. Epic Jira tasks are a separate, simple cache: project members read `GET /api/epics/{id}/jira-issues`; coordinators/admins run `POST /api/epics/{id}/jira-issues/refresh` from the epic JQL. There is no Epic sync worker, scheduler or release-analytics dashboard. The migration seeds exactly one row for each supported type. Never lazily create one or fall back to `User.kanban_token`; the legacy per-user poll is disabled. External payloads are inconsistent, so keep normalization centralized and defensive. Preserve request timeout diagnostics and avoid exposing tokens in errors/logs.

### Database changes

Never use `Base.metadata.create_all()` as a schema-change mechanism. Add a new linear Alembic revision after `0018_release_center`, update ORM and Pydantic/frontend DTOs together, and run `tests/test_alembic.py`. Migrations must work for both empty databases and upgrades from the previous head. `bootstrap.py` contains deliberate compatibility logic for databases that predate Alembic; do not remove it casually.

## Frontend design

### Provider and routing structure

`main.tsx` loads static fonts/styles and renders `App`. `App.tsx` owns the `QueryClient`, theme provider, tooltip provider, auth provider, router, public auth routes, protected shell routes, and admin guards. `RequireAuth` and `RequireAdmin` are the route boundaries. Add new routes in `App.tsx` and navigation entries in `lib/navigation.ts` when applicable.

Pages/components inherited from a reference UI may import the wouter-like API from `lib/router.tsx`; it is a compatibility adapter over React Router. Do not replace it piecemeal unless the affected consumers are migrated and tested.

### Server state and the DataBridge trap

TanStack Query is the real server-state layer (`lib/queries.ts`, plus `lib/kanban-ds/queries.ts`). However, older screens import mutable arrays from `src/data/*`. `contexts/DataBridge.tsx` subscribes to core queries and synchronizes those arrays before descendants render. It also delays data-heavy routes until the first fetch wave completes.

Therefore, after a mutation:

- update/invalidate the detail query;
- refetch relevant list roots (`tickets`, `ticket-summary`, `activity`, etc.);
- call `bumpDataVersion()` when a legacy data module must re-render;
- preserve the admin-users vs directory-users split.

Follow an adjacent mutation hook rather than inventing a narrower invalidation. Structural sharing is why ticket syncing keys off `dataUpdatedAt`, not only object identity.

### UI conventions

- Imports use the `@/* -> src/*` alias.
- TypeScript is strict, though unused/no-explicit-any checks are intentionally relaxed; still prefer precise types.
- API types use backend-shaped names in `lib/types.ts`; `lib/mappers.ts` adapts them to legacy/reference UI shapes.
- Reuse `components/ui/*` primitives, shared badges/avatars/pagination/empty states, and existing layout patterns.
- Tailwind v4 is configured through PostCSS and `@import "tailwindcss"` in `index.css`; there is no `tailwind.config.js`.
- Theme tokens are CSS HSL variables. Support both `.dark` and light mode; do not hardcode colors where a semantic token exists.
- Keep API access in hooks/adapters, not directly scattered through page components.
- Sanitize rendered user HTML/Markdown via the existing DOMPurify/rehype-sanitize paths.
- User-visible timestamps should go through `lib/formatDateTime.ts` or existing date helpers.

### Main browser routes

Public: `/login`, `/register`. Protected core: `/`, `/inbox`, `/questions`, `/questions/:id`, `/epics`, `/epics/:id`, `/projects`, `/projects/:id`, `/activity`, `/statistics`, `/settings`, `/profile`, `/users/:id`, `/feedback`. Admin-only routes include `/users`, `/admin/feedback`, the `/admin/kanban/*` board/member-role area, and `/admin/kanban/analytics/*` plus summary/workload screens. Confirm the exact table in `App.tsx` before adding redirects or navigation.

## Testing guidance by change type

| Change | Minimum focused verification |
| --- | --- |
| auth, roles, project access | `test_auth_and_access.py`, `test_security_fixes.py`, relevant frontend login/navigation tests |
| ticket CRUD/state/messages | `test_ticket_crud.py`, `test_ticket_transitions.py`, `test_notifications_feedback.py` |
| epics/QA | `test_epic_crud.py` and affected frontend release/epic tests |
| files/storage | `test_files_filter.py`, attachment UI path |
| realtime/SSE | `test_realtime.py`, `realtimeStatusIndicator.test.tsx`, `useEventStream.test.tsx` |
| Kanban auth/board | `test_kanban_auth.py`, frontend Kanban mapper/query or bulk-create tests |
| Kanban analytics | snapshot, daily-summary, epic-chart tests and release-planning engine tests |
| frontend mappings/DataBridge | `mappers.test.ts`, `dataBridge.test.ts`, relevant page tests |
| schema/migration | new migration test plus full `test_alembic.py` |
| deployment | production compose config, Docker build if feasible |

For a bug fix, add a regression test near the closest existing behavior. Backend tests should assert access denial as well as the happy path. Frontend tests should mock at the API/query boundary and avoid coupling to incidental markup.

## Change checklist and invariants

Before editing:

1. Check `git status`; preserve unrelated user changes.
2. Read the complete target module and its nearest tests, DTOs, and call sites.
3. For API changes, trace backend schema -> query hook -> mapper -> component.
4. For lifecycle changes, trace DB mutation -> audit/domain event -> notification/outbound -> SSE -> frontend invalidation.

While editing:

- keep authorization server-side even if the UI hides an action;
- do not expose raw upstream errors, credentials, password hashes, or Kanban tokens;
- do not bypass Alembic, notification idempotency, or the central API wrapper;
- preserve pagination response shapes (`items`, `total`, `page`, `page_size`);
- preserve Caddy's special unbuffered `/api/stream` handling and SPA fallback;
- keep production image-only: no source checkout, bind-mounted source, tests, `.env`, `.git`, or source maps in images;
- do not run destructive volume/database cleanup without explicit user intent.

Before handoff:

1. Run focused tests during iteration and the broadest relevant gate at the end.
2. Check `git diff --check` and review `git diff` for accidental generated files or secrets.
3. If commands could not run, state exactly what was and was not verified.
4. Update this file when a change invalidates any entry above.

## Known sharp edges

- `deploy/` is the only supported deployment tree; avoid introducing parallel root-level deployment files.
- Realtime is process-local, so increasing API workers silently breaks consistent SSE delivery.
- `DataBridge` means a successful mutation can still leave old screens stale unless list refetch + bridge bump are correct.
- Admin unrestricted access is represented by an empty allowed-project list; do not interpret it as “no access”.
- The ORM and Pydantic modules both define QA enums; keep their values synchronized with frontend unions/reference data.
- Matrix/Telegram delivery is queued and scheduled, not immediate; tests should inspect durable jobs/events rather than expect network calls.
- SQLite test behavior is useful but not identical to PostgreSQL; migration and SQL-sensitive changes deserve PostgreSQL/local-compose verification.
- The ignored root `.env` may contain real secrets. Inspect keys only unless values are strictly required and authorized.
- `README.md` is product-facing and may lag implementation details; resolve discrepancies in favor of code, migrations, CI, and `deploy/`, then update docs if the task includes it.
