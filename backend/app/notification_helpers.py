from __future__ import annotations

from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .correlation_context import get_correlation_id
from .domain_event_service import log_domain_event
from .domain_events.catalog import notification_delivery_defaults
from .models import Notification
from .realtime import publish_event


def create_notification(
    db: Session,
    *,
    recipient_id: int,
    type: str,
    title: str,
    body: str,
    target_type: str,
    target_id: int,
    target_url: str,
    dedupe_key: str,
    correlation_id: str | None = None,
    operation_context_id: int | None = None,
    project_id: int | None = None,
    group_key: str | None = None,
    severity: str | None = None,
    urgency: str | None = None,
    metadata_json: dict | None = None,
    lifecycle_status: str = "unread",
    skip_domain_event: bool = False,
    escalation_parent_id: int | None = None,
    defer_commit: bool = False,
) -> Notification | None:
    defaults = notification_delivery_defaults(type)
    cid = correlation_id or get_correlation_id()

    notification = Notification(
        recipient_id=recipient_id,
        type=type,
        title=title,
        body=body,
        target_type=target_type,
        target_id=target_id,
        target_url=target_url,
        dedupe_key=dedupe_key,
        lifecycle_status=lifecycle_status,
        severity=severity or defaults.severity,
        urgency=urgency or defaults.urgency,
        correlation_id=cid,
        operation_context_id=operation_context_id,
        project_id=project_id,
        group_key=group_key,
        metadata_json=metadata_json or {},
        escalation_parent_id=escalation_parent_id,
        delivery_intent=defaults.delivery_intent.value,
    )

    db.add(notification)

    try:
        db.flush()
        if not skip_domain_event:
            ev = log_domain_event(
                db,
                name=defaults.domain_event.value,
                taxonomy_class=defaults.taxonomy.value,
                notification_relevance=defaults.relevance.value,
                primary_classification=defaults.primary.value,
                operation_context_id=operation_context_id,
                correlation_id=cid or str(uuid4()),
                aggregate_type=target_type if target_type in {"ticket", "epic"} else None,
                aggregate_id=target_id if target_type in {"ticket", "epic"} else None,
                payload={
                    "notification_type": type,
                    "recipient_id": recipient_id,
                    "dedupe_key": dedupe_key,
                },
            )
            notification.source_event_id = ev.event_id
        if defer_commit:
            return notification
        db.commit()
        db.refresh(notification)
        meta = notification.metadata_json if isinstance(notification.metadata_json, dict) else {}
        publish_event(
            [recipient_id],
            "notification.created",
            {
                "id": notification.id,
                "type": notification.type,
                "title": notification.title,
                "body": notification.body,
                "target_type": notification.target_type,
                "target_id": notification.target_id,
                "target_url": notification.target_url,
                "severity": notification.severity,
                "urgency": notification.urgency,
                "correlation_id": notification.correlation_id,
                "lifecycle_status": notification.lifecycle_status,
                "metadata": meta,
                "project_slug": meta.get("project_slug") if meta else None,
            },
        )
        return notification
    except IntegrityError:
        db.rollback()
        return None
