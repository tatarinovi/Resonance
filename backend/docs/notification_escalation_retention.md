# Escalation and retention

## Escalation (`escalation_service.run_escalation_pass`)

- Candidates: unread notifications with `severity ∈ {high,critical}`, `urgency ∈ {active,interrupt}`, age ≥ 24h, `escalation_round < 3`, not muted, not already a reminder row.
- Action: creates `NotificationType.REMINDER_UNREAD` child linked via `escalation_parent_id`, dedupe `esc:{parent}:{round}`, `defer_commit` batched with parent counter bumps.
- Scheduler: hourly cron (`:22` every hour) — tune frequency as needed.

## Retention (`retention_service`)

- `notification_delivery_attempts`: purge rows older than **180 days** (weekly Sunday 04:10 UTC).
- `domain_event_logs`: purge rows older than **90 days** (same job).

## Ledger notifications

User-visible rows use lifecycle columns (`lifecycle_status`, `read_at`, …). Hot retention for `notifications` table itself is not automated yet; add archival when volume warrants partitioning.
