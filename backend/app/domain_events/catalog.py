"""Canonical domain notification / event catalog for Resonance.

Maps in-app `Notification.type` strings to domain event names, taxonomy,
primary vs derived classification, severity/urgency, and **delivery semantics**
(personal vs broadcast intent — not transport channel names).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..models import NotificationType


class DomainEventName(str, Enum):
    """Stable business-oriented event identifiers stored in `domain_event_logs.name`."""

    TICKET_CREATED = "ticket.created"
    TICKET_FORWARDED = "ticket.forwarded"
    TICKET_ANSWERED = "ticket.answered"
    TICKET_RETURNED = "ticket.returned"
    TICKET_MENTIONED = "ticket.mentioned"
    TICKET_WATCH_MESSAGE = "ticket.watch.message"
    TICKET_WATCH_STATUS = "ticket.watch.status"
    TICKET_SLA_STAGNATION = "ticket.sla.stagnation"
    EPIC_QA_IN_TESTING = "epic.qa.in_testing"
    EPIC_QA_BLOCKED = "epic.qa.blocked"
    TICKET_OPERATION_SUMMARY = "ticket.operation.summary"
    REMINDER_UNREAD = "notification.reminder.unread"
    DIGEST_MORNING = "digest.morning"
    DIGEST_EVENING = "digest.evening"
    KANBAN_TASK_NEW = "kanban.task.new"

    INTERNAL_UNREAD_COUNTER = "internal.unread_counter.updated"
    INTERNAL_DIGEST_AGGREGATE = "internal.digest.aggregate.touched"


class DeliveryIntent(str, Enum):
    """Why we notify — drives suppress/debounce rules and prohibits personal→room fallback."""

    PERSONAL_ACTION_REQUIRED = "personal_action_required"
    PERSONAL_INFO = "personal_info"
    TEAM_AWARENESS = "team_awareness"
    DIGEST = "digest"
    ESCALATION = "escalation"


class EventTaxonomyClass(str, Enum):
    BUSINESS = "business"
    INTERNAL = "internal"
    TRANSPORT = "transport"
    DELIVERY = "delivery"
    AUDIT = "audit"


class NotificationRelevance(str, Enum):
    NONE = "none"
    CANDIDATE_PRIMARY = "candidate_primary"
    CANDIDATE_DERIVED = "candidate_derived"
    SUPPRESSED = "suppressed"


class EventPrimaryClassification(str, Enum):
    PRIMARY = "primary"
    DERIVED = "derived"


_SCHEMA_VERSION = 2


def schema_version() -> int:
    return _SCHEMA_VERSION


@dataclass(frozen=True)
class DeliveryDefaults:
    severity: str
    urgency: str
    taxonomy: EventTaxonomyClass
    relevance: NotificationRelevance
    primary: EventPrimaryClassification
    domain_event: DomainEventName
    delivery_intent: DeliveryIntent
    personal_required: bool
    """If True, personal channels must be attempted when user is not in_app_only (never replace with room)."""
    allow_broadcast_companion: bool
    """If True, an optional anonymized broadcast job may be queued alongside personal delivery (never as fallback)."""


_NOTIFICATION_TYPE_MAP: dict[str, DeliveryDefaults] = {
    NotificationType.TICKET_CREATED.value: DeliveryDefaults(
        severity="normal",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_CREATED,
        delivery_intent=DeliveryIntent.PERSONAL_ACTION_REQUIRED,
        personal_required=True,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_FORWARDED.value: DeliveryDefaults(
        severity="high",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_FORWARDED,
        delivery_intent=DeliveryIntent.PERSONAL_ACTION_REQUIRED,
        personal_required=True,
        allow_broadcast_companion=True,
    ),
    NotificationType.TICKET_ANSWERED.value: DeliveryDefaults(
        severity="normal",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_ANSWERED,
        delivery_intent=DeliveryIntent.PERSONAL_INFO,
        personal_required=False,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_RETURNED.value: DeliveryDefaults(
        severity="normal",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_RETURNED,
        delivery_intent=DeliveryIntent.PERSONAL_ACTION_REQUIRED,
        personal_required=True,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_MENTIONED.value: DeliveryDefaults(
        severity="normal",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_MENTIONED,
        delivery_intent=DeliveryIntent.PERSONAL_INFO,
        personal_required=False,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_WATCH_MESSAGE.value: DeliveryDefaults(
        severity="low",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_DERIVED,
        primary=EventPrimaryClassification.DERIVED,
        domain_event=DomainEventName.TICKET_WATCH_MESSAGE,
        delivery_intent=DeliveryIntent.TEAM_AWARENESS,
        personal_required=False,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_WATCH_STATUS.value: DeliveryDefaults(
        severity="low",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_DERIVED,
        primary=EventPrimaryClassification.DERIVED,
        domain_event=DomainEventName.TICKET_WATCH_STATUS,
        delivery_intent=DeliveryIntent.TEAM_AWARENESS,
        personal_required=False,
        allow_broadcast_companion=False,
    ),
    NotificationType.TICKET_SLA_STAGNATION.value: DeliveryDefaults(
        severity="high",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.TICKET_SLA_STAGNATION,
        delivery_intent=DeliveryIntent.ESCALATION,
        personal_required=True,
        allow_broadcast_companion=False,
    ),
    NotificationType.EPIC_QA_IN_TESTING.value: DeliveryDefaults(
        severity="normal",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.EPIC_QA_IN_TESTING,
        delivery_intent=DeliveryIntent.TEAM_AWARENESS,
        personal_required=False,
        allow_broadcast_companion=True,
    ),
    NotificationType.EPIC_QA_BLOCKED.value: DeliveryDefaults(
        severity="critical",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.EPIC_QA_BLOCKED,
        delivery_intent=DeliveryIntent.PERSONAL_ACTION_REQUIRED,
        personal_required=True,
        allow_broadcast_companion=False,
    ),
    NotificationType.REMINDER_UNREAD.value: DeliveryDefaults(
        severity="high",
        urgency="active",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.REMINDER_UNREAD,
        delivery_intent=DeliveryIntent.ESCALATION,
        personal_required=True,
        allow_broadcast_companion=False,
    ),
    NotificationType.KANBAN_TASK_NEW.value: DeliveryDefaults(
        severity="normal",
        urgency="passive",
        taxonomy=EventTaxonomyClass.BUSINESS,
        relevance=NotificationRelevance.CANDIDATE_PRIMARY,
        primary=EventPrimaryClassification.PRIMARY,
        domain_event=DomainEventName.KANBAN_TASK_NEW,
        delivery_intent=DeliveryIntent.PERSONAL_INFO,
        personal_required=False,
        allow_broadcast_companion=False,
    ),
}


def notification_delivery_defaults(notification_type: str) -> DeliveryDefaults:
    return _NOTIFICATION_TYPE_MAP.get(
        notification_type,
        DeliveryDefaults(
            severity="normal",
            urgency="passive",
            taxonomy=EventTaxonomyClass.BUSINESS,
            relevance=NotificationRelevance.CANDIDATE_PRIMARY,
            primary=EventPrimaryClassification.PRIMARY,
            domain_event=DomainEventName.TICKET_OPERATION_SUMMARY,
            delivery_intent=DeliveryIntent.PERSONAL_INFO,
            personal_required=False,
            allow_broadcast_companion=False,
        ),
    )


def default_domain_event_for_notification_type(notification_type: str) -> DomainEventName:
    return notification_delivery_defaults(notification_type).domain_event


AUDIENCE_RULES_TEXT: dict[DomainEventName, str] = {
    DomainEventName.TICKET_CREATED: "project leads (coordinator/admin on project)",
    DomainEventName.TICKET_FORWARDED: "target expert / direction experts on project",
    DomainEventName.TICKET_ANSWERED: "ticket author (mapped username)",
    DomainEventName.TICKET_RETURNED: "ticket author",
    DomainEventName.TICKET_MENTIONED: "mentioned users in project",
    DomainEventName.TICKET_WATCH_MESSAGE: "ticket subscribers except author",
    DomainEventName.TICKET_WATCH_STATUS: "ticket subscribers except actor",
    DomainEventName.TICKET_SLA_STAGNATION: "project leads + assignee",
    DomainEventName.EPIC_QA_IN_TESTING: "QA subscribers / epic roles",
    DomainEventName.EPIC_QA_BLOCKED: "QA + epic leads",
    DomainEventName.REMINDER_UNREAD: "original recipient + optional lead escalation",
    DomainEventName.KANBAN_TASK_NEW: "Kanban user (personal token poll)",
}
