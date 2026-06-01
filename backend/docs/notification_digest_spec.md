# Digest specification (morning / evening)

## Scheduling

- Cron triggers run in **UTC** on the API host (`AsyncIOScheduler`): morning 09:00 Mon–Fri, evening 19:00 Mon–Fri.
- Per-project enable flags remain in `Project.config_json`: `morning_digest_enabled`, `evening_digest_enabled`, expert room map `expert_rooms`.

## Morning digest

- Audience: Matrix expert rooms grouped by direction.
- Payload highlights forwarded ticket counts and Matrix mentions for epic leads when metadata exists.
- Empty forwarded sets → skip send (no `DigestRun` row).

## Evening digest

- Metrics: tickets created today, answered/closed today with `updated_at` today, currently forwarded.
- Sends to the analytics expert room only (`expert_rooms.analytics`) — legacy behaviour preserved.

## Audit trail

Each send writes a `digest_runs` row (`kind=morning|evening`) with `snapshot_json`, `matrix_event_id` when available, or `error_message` on failure.

## Future work

- User/workspace timezone fields and `digest_schedules` table for local morning/evening windows.
- Suppress empty evening digest rows when counts are zero (currently still sends informational totals).
