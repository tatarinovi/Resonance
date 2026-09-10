# QA leaderboard

The `/leaderboard` screen recognizes QA contribution inside Resonance. It is not a performance-review or employment-decision system.

## Domain and access

Participants use existing `User` fields: `role=employee`, `direction=qa`, `workspace=ds`. Administrators are viewers and moderators, never competitors. This feature deliberately does not filter by project membership. Only names, totals and ranks are team-visible; detailed activity is self/admin only, enforced by `/api/leaderboard/activity`.

`leaderboard_seasons` stores the rules and participant/name roster used for the month. Business months use `Europe/Moscow`, matching existing business digests, while DB timestamps remain UTC-naive. Contributions are indexed by season/participant/date and uniquely identified by season/source/source key/participant/event. Each retains points, eligibility, source timestamp, explanation and evidence. Totals use one grouped DB query; equal totals share competition rank (1, 2, 2, 4), with name/id as deterministic display ordering. Zero-score participants remain visible.

Ordinary writes require the real current month. Rollover freezes the previous persisted roster and contributions without consulting today's external entities. Active eligibility is refreshed every minute and on leaderboard reads. Rules are copied from `leaderboard_rules.py` at season creation; future code changes do not reinterpret existing seasons.

## Source contract

Global encrypted credentials and integration connections are reused. No credentials are stored in leaderboard tables.

* **Kanban:** source scope is Resonance Epics with `kanban_url`. The adapter reads the Epic and its child tasks, then QA-role worklogs using the existing global Kanban member-role map, including work logged directly on the Epic as the analytics view does. `QA_ACTUAL_MATCH` compares their total QA hours (the existing two-decimal representation) against `Epic.qa_estimate_hours`. Eligible `qa_member_ids` receive the match. The source date is the latest underlying QA worklog `begin`, never import time. Null, zero/unset and non-finite estimates do not score. `is_actual` only selects a current Kanban responsible estimate: it is **not** tracked time. `QA_LEAD_MATCH` compares the participant's current responsible estimate to the single current estimate attributed to a Resonance DS QA coordinator/manager. Roles come from Resonance identity mapping, not a guessed Kanban Lead role. Missing or multiple Lead estimates are diagnostic and do not score. No new Epic estimate fields were added.
* **Jira:** default scope is the union of configured Epic JQLs; an admin can supply a team-wide JQL. Search requests include source creation timestamps, reporter, issue type and environment. The month is determined from `created`, with a one-day query overlap for Jira account timezones. The configured environment field (default `environment`, optionally `customfield_N`) takes precedence over title parsing. DEV/STAGE must be unambiguous whole tokens. Supported bug type names are Bug/Баг/Ошибка/Дефект. Reporter accountId/key/login is matched explicitly to a Resonance user. Every candidate starts pending; only admin confirmation awards points. Ownership/environment changes return confirmation to pending, rejection removes active points, and disappearance from a complete JQL result invalidates the candidate while retaining it for audit.
* **TestOps:** default scope is launches linked through Epic test runs and their projects' cases. Optional project IDs include other launches in those projects. `createdBy` plus `createdDate` attributes creation, with an exactly `active` status; archived/deleted flags exclude the case. Executions require `testedBy` and the actual `stop` timestamp, with detail lookup if the list payload omits them. Passed/failed/blocked count equally; skipped, unknown and broken are conservatively excluded (broken may be infrastructure rather than QA work). Distinct result IDs aggregate once per launch/QA/month into a single tier. Neither launch creation nor import timestamps substitute for execution time.

Identity mappings are explicit and admin-audited because the pre-existing user model has no Jira/TestOps account mappings. Kanban IDs also require explicit attribution; the old per-user credential/polling cache is not trusted as an identity registry. Unmatched/ambiguous data is shown in diagnostics, never matched by display-name similarity.

TestOps installations may expose different DTOs/status workflows. Fields must be verified against the deployment's Swagger (`/swagger-ui.html`); unavailable attribution/status/timestamps are reported, not inferred from assignees, modifiers, or a run's creation time. References: [TestOps API](https://docs.qameta.io/reference/api/), [attribution fields](https://docs.qameta.io/reference/aql/).

## Synchronization and safety

The existing FastAPI process runs a lightweight asynchronous poll loop; synchronous HTTP/DB work runs in a thread. It checks every minute and syncs every ten minutes, independently of leaderboard reads. Admin sync requests use FastAPI background work. PostgreSQL advisory locks serialize source-sync passes across API processes and separately protect transactional leaderboard mutations. Production retains the existing single API worker requirement, including for the persisted backfill request's in-process execution guard.

Each source has a 90-second wall-clock budget and each HTTP request at most 30 seconds. Paginated Jira/TestOps queries cap at 20,000 entries per collection and reject duplicate, malformed or truncated pagination. Only a completed source snapshot retires old active contributions. HTTP/timeouts keep the previous successful source snapshot and show a safe diagnostic. One source failure does not stop the other sources. Detailed problem lists are capped at 100 entries while their full count remains visible.

Jira uses a date-restricted query. The existing TestOps/Kanban APIs do not provide a verified changed-since contract here, so their explicit scopes are scanned within the bounds above. Large installations should select narrower supported scopes; hitting a bound is reported and preserves data. No unrestricted historical crawl runs at startup.

## Administration and history

The management tab provides candidate decisions, private activity, source diagnostics, exact identity mappings, team-wide source scopes, refresh, signed manual adjustments and explicit initial historical import.

Manual adjustments are separate immutable contributions, never writes to a user score. They require a reason and record admin/time/season in `leaderboard_audit`. Changing a closed month additionally requires explicit historical acknowledgement. Their explanations are visible to the participant; internal evidence remains admin-only.

Historical import is explicit, bounded and only creates a previously absent month. The request is persisted and resumes after a process restart. It gathers sources before creating the season; a source failure leaves no partial season. Successful imports freeze immediately. The admin must acknowledge that existing APIs provide **current source state and current user eligibility**, not a reconstruction of month-end state. Source dates remain real; the limitation and diagnostics are recorded in the audit. Jira candidates are imported unscored; after reviewing historical bugs, an admin can add an auditable correction. Existing historical seasons cannot be rebuilt in place or changed by ordinary source refresh; corrections are the deliberate repair path.

At month boundaries, freezing represents the last successfully persisted snapshot. Outages, late-arriving work, missing mappings and entities deleted before first import may require an explicit historical correction. No former source state or author is fabricated.

## Storage, routes and rollout

Migration `0021_qa_leaderboard` follows `0020_release_insights` and adds five tables: seasons, contributions, bugs, identities and audit. It does not change user/project/Release schemas. Apply the normal production migration job before rolling out the application.

API prefix `/api/leaderboard`:

* `GET /` — board, season list and season rules.
* `GET /activity` — paginated self/admin contribution details.
* `GET /admin` — paginated bugs, sync state, mappings, settings and recent audit.
* `POST /bugs/{id}/decision` — admin confirm/reject with reason.
* `POST /seasons/{season}/adjustments` — signed audited adjustment.
* `PUT /identities`, `PUT /sources` — audited admin configuration.
* `POST /sync`, `POST /backfill` — background synchronization and explicit historical import.

Configure existing global connections, then source scopes and exact identities in the management tab. Check diagnostics after the first synchronization before relying on totals. Live external-instance credentials/data are not needed for the automated tests and were not used during implementation validation.

Focused checks: `backend/.venv/bin/python -m pytest backend/tests/test_leaderboard.py backend/tests/test_alembic.py`, plus frontend `leaderboard.test.tsx` and `navigation.test.ts`. PostgreSQL migration validation includes empty-database migration through 0020, a preserved user, upgrade to 0021, downgrade and re-upgrade.

## Implementation validation (2026-09-11)

* `cd backend && .venv/bin/python -m pytest -q`: **206 passed**. HTTP tests ran outside the restricted sandbox after TestClient stalled inside it.
* `cd frontend && npm run typecheck`: passed.
* `cd frontend && npm run test:run`: **78 passed**, 18 files.
* `cd frontend && npm run lint`: passed with 0 errors and 40 warnings in existing non-leaderboard code.
* `cd frontend && npm run build`: passed; existing large-chunk warning remains.
* Alembic on isolated PostgreSQL 17: empty database through 0020, insert existing user, upgrade 0021, downgrade 0020, re-upgrade 0021; user preserved and five new tables verified. SQLite upgrade/downgrade and uniqueness checks are also automated.
* Browser verification used the actual built app and an isolated PostgreSQL database with synthetic data: ranking, ties, zero totals, a long participant name, navigation and administrative forms were checked. The temporary preview and database were stopped afterward.
* Final whitespace/diff and debugging-code checks passed. No production credentials, external live data, deployed application database or existing containers were changed.
