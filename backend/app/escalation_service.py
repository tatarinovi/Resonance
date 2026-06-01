"""Unread escalation: reminders for high/critical active notifications (batch scheduler)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Notification, NotificationType, User
from .notification_helpers import create_notification
from .notification_routing import enqueue_personal_delivery
from .realtime import publish_event
from .resonance_paths import question_absolute_url

logger = logging.getLogger(__name__)

REMINDER_AFTER_HOURS = 24
MIN_REMINDER_GAP_HOURS = 12
MAX_ESCALATION_ROUNDS = 3


def _reminder_outbound_html(parent: Notification) -> str:
    settings = get_settings()
    if parent.target_type == "ticket":
        link = question_absolute_url(settings.frontend_url, parent.target_id)
    else:
        link = settings.frontend_url.rstrip("/")
    return (
        "⏰ <b>Напоминание: требуется внимание</b>"
        f"\n\n{parent.title}"
        f"\n\n🔗 <a href='{link}'>Открыть в Resonance</a>"
    )


def run_escalation_pass(db: Session) -> int:
    """Create at most one reminder per eligible parent notification."""
    now = datetime.utcnow()
    eligible_before = now - timedelta(hours=REMINDER_AFTER_HOURS)
    gap_cutoff = now - timedelta(hours=MIN_REMINDER_GAP_HOURS)

    stmt = (
        select(Notification)
        .where(
            Notification.is_read.is_(False),
            Notification.lifecycle_status == "unread",
            Notification.severity.in_(("high", "critical")),
            Notification.urgency.in_(("active", "interrupt")),
            Notification.escalation_parent_id.is_(None),
            Notification.type != NotificationType.REMINDER_UNREAD.value,
            Notification.created_at <= eligible_before,
            Notification.escalation_round < MAX_ESCALATION_ROUNDS,
            or_(Notification.last_escalation_at.is_(None), Notification.last_escalation_at <= gap_cutoff),
            Notification.muted.is_(False),
        )
        .limit(50)
    )
    parents = list(db.scalars(stmt).all())
    created = 0
    for parent in parents:
        rnd = parent.escalation_round + 1
        dedupe = f"esc:{parent.id}:r{rnd}"
        exists = db.scalar(
            select(Notification.id).where(Notification.recipient_id == parent.recipient_id, Notification.dedupe_key == dedupe)
        )
        if exists:
            continue
        child = create_notification(
            db,
            recipient_id=parent.recipient_id,
            type=NotificationType.REMINDER_UNREAD.value,
            title="Напоминание: требуется внимание",
            body=parent.title[:240],
            target_type=parent.target_type,
            target_id=parent.target_id,
            target_url=parent.target_url,
            dedupe_key=dedupe,
            correlation_id=parent.correlation_id,
            operation_context_id=parent.operation_context_id,
            project_id=parent.project_id,
            group_key=parent.group_key,
            severity="high",
            urgency="active",
            metadata_json={"escalation_parent_notification_id": parent.id, "round": rnd},
            skip_domain_event=True,
            escalation_parent_id=parent.id,
            defer_commit=True,
        )
        if child is None:
            continue
        parent.escalation_round = rnd
        parent.last_escalation_at = now
        db.commit()
        db.refresh(child)
        recipient = db.get(User, child.recipient_id)
        if recipient:
            enqueue_personal_delivery(
                db,
                user=recipient,
                notification_type=NotificationType.REMINDER_UNREAD.value,
                notification_id=child.id,
                severity=child.severity,
                html=_reminder_outbound_html(parent),
                matrix_override_mxid=None,
                operation_context_id=child.operation_context_id,
                correlation_id=child.correlation_id,
                idempotency_suffix=str(child.id),
                debounce_matrix_override=False,
            )
            db.commit()
        child_meta = child.metadata_json if isinstance(child.metadata_json, dict) else {}
        publish_event(
            [child.recipient_id],
            "notification.created",
            {
                "id": child.id,
                "type": child.type,
                "title": child.title,
                "body": child.body,
                "target_type": child.target_type,
                "target_id": child.target_id,
                "target_url": child.target_url,
                "severity": child.severity,
                "urgency": child.urgency,
                "correlation_id": child.correlation_id,
                "lifecycle_status": child.lifecycle_status,
                "metadata": child_meta,
                "project_slug": child_meta.get("project_slug") if child_meta else None,
            },
        )
        created += 1
        logger.info("Escalation reminder %s for notification %s round %s", child.id, parent.id, rnd)
    return created
