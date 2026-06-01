"""Aggregation / suppression rules (anti event-explosion).

Coalescing windows and suppression matrix are pure data used when emitting outbound jobs.
Ledger dedupe remains `(recipient_id, dedupe_key)`; callers may suffix dedupe with correlation_id.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain_events.catalog import DeliveryIntent
from .models import NotificationType

# Temporal coalesce hint for Matrix (seconds) — outbound worker may debounce by bucket.
MATRIX_DEBOUNCE_BUCKET_SECONDS = 90

# Sliding window for grouping noisy watcher traffic (documentation / future buffer TTL).
COALESCE_WINDOW_SECONDS = 120


@dataclass(frozen=True)
class SuppressionRule:
    """When primary event kinds appear together under same correlation, suppress outbound for noisy kinds."""

    if_primary_contains: frozenset[str]
    suppress_types: frozenset[str]


# Example: message activity plus assignee/status churn → Matrix prefers single summary (handled via dedupe policy).
_SUPPRESSION_MATRIX: tuple[SuppressionRule, ...] = (
    SuppressionRule(
        if_primary_contains=frozenset(
            {
                NotificationType.TICKET_WATCH_MESSAGE.value,
                NotificationType.TICKET_MENTIONED.value,
            }
        ),
        suppress_types=frozenset({NotificationType.TICKET_WATCH_STATUS.value}),
    ),
)

INTERNAL_NEVER_NOTIFY_TYPES: frozenset[str] = frozenset(
    {
        # Reserved for future internal counters — never materialize as Notification rows.
    }
)


def should_suppress_outbound_for_matrix(
    *,
    notification_type: str,
    sibling_types_in_correlation: frozenset[str],
    delivery_intent: str | None = None,
) -> bool:
    """Returns True if Matrix outbound should be skipped (in-app still allowed elsewhere).

    Suppression matrix applies only to team-awareness / digest traffic — never to operational personal intents.
    """
    if delivery_intent is not None and delivery_intent not in (
        DeliveryIntent.TEAM_AWARENESS.value,
        DeliveryIntent.DIGEST.value,
    ):
        return False
    for rule in _SUPPRESSION_MATRIX:
        if not rule.if_primary_contains.intersection(sibling_types_in_correlation):
            continue
        if notification_type in rule.suppress_types:
            return True
    return False


def outbound_matrix_allowed_for_urgency(*, urgency: str, severity: str, room_broadcast: bool) -> bool:
    """Room broadcasts only for elevated urgency/severity unless caller overrides."""
    if room_broadcast:
        return severity in {"high", "critical"} or urgency in {"active", "interrupt"}
    return True


def group_key_for_ticket(ticket_id: int, suffix: str = "activity") -> str:
    return f"ticket:{ticket_id}:{suffix}"
