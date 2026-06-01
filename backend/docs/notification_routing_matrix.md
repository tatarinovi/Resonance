# Notification routing matrix (semantic surfaces)

This document matches the **Semantic Delivery Channels** product rules implemented in code.

## Surfaces

| Surface | Meaning |
|--------|---------|
| **In-app ledger** | Required source of truth for user-visible notifications (`notifications` table). |
| **Personal** | Matrix DM and Telegram DM — operational layer for a single recipient. |
| **Broadcast** | Project Matrix rooms — team awareness only; **never** a fallback when personal delivery fails. |

Outbound queue rows (`notification_outbound_jobs`) record `delivery_target_type` as `personal` or `broadcast`. In-app rows are not queued.

## Delivery intents

| Intent | Typical types | Personal jobs | Broadcast companion |
|--------|----------------|---------------|---------------------|
| `personal_action_required` | New ticket (leads), forwarded, returned, epic QA blocked | Yes (per user prefs + availability) | Only if `allow_broadcast_companion` and caller sends **de-identified** room copy |
| `personal_info` | Answered, mentions | Yes | No |
| `team_awareness` | Watch message/status, epic QA in testing | Yes (often low-noise) | Optional where catalog allows |
| `escalation` | SLA stagnation, unread reminders | Yes | No |
| `digest` | Scheduled digests (separate paths) | Policy-specific | Usually room-only |

## Fallback rule

**Forbidden:** routing operational personal intents to a project/expert Matrix room because DM/Telegram failed or is disabled.

When personal transports are unavailable: ledger remains authoritative; jobs may fail with recorded attempts; users see delivery health hints after configuring channels.

## User preference: `personal_channel_mode`

Stored on `user_notification_preferences.personal_channel_mode` (API: `GET/PUT /auth/me` field `personal_channel_mode`).

| Mode | Behaviour |
|------|-----------|
| `in_app_only` | No Matrix DM / Telegram outbound jobs. |
| `matrix_preferred` | Matrix DM first; Telegram as fallback or secondary for high-severity / escalation-style intents when eligible. |
| `telegram_preferred` | Telegram first; symmetric secondary Matrix rule. |
| `both` | Enqueue both personal channels when each is eligible. |

## Suppression / debounce

- Matrix duplicate-suppression matrix (`aggregation.should_suppress_outbound_for_matrix`) applies only when `delivery_intent` is `team_awareness` or `digest` (or legacy callers omit intent).
- Matrix debounce buckets apply to `personal_info` and `team_awareness` DMs; **not** to `personal_action_required` or `escalation`.

## Type → intent (catalog)

Authoritative mapping: `backend/app/domain_events/catalog.py` (`DeliveryDefaults` per `NotificationType`).
