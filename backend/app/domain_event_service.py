"""Append-only domain event log."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from .correlation_context import get_correlation_id
from .domain_events.catalog import (
    EventPrimaryClassification,
    EventTaxonomyClass,
    NotificationRelevance,
)
from .models import DomainEventLog


def log_domain_event(
    db: Session,
    *,
    name: str,
    taxonomy_class: EventTaxonomyClass | str,
    notification_relevance: NotificationRelevance | str,
    primary_classification: EventPrimaryClassification | str,
    payload: dict | None = None,
    aggregate_type: str | None = None,
    aggregate_id: int | None = None,
    causation_event_id: str | None = None,
    operation_context_id: int | None = None,
    event_id: str | None = None,
    correlation_id: str | None = None,
    occurred_at: datetime | None = None,
    version: int = 1,
) -> DomainEventLog:
    cid = correlation_id or get_correlation_id() or str(uuid4())
    ev_id = event_id or str(uuid4())
    tax = taxonomy_class.value if isinstance(taxonomy_class, EventTaxonomyClass) else taxonomy_class
    rel = notification_relevance.value if isinstance(notification_relevance, NotificationRelevance) else notification_relevance
    prim = primary_classification.value if isinstance(primary_classification, EventPrimaryClassification) else primary_classification
    row = DomainEventLog(
        event_id=ev_id,
        name=name,
        version=version,
        occurred_at=occurred_at or datetime.utcnow(),
        correlation_id=cid,
        causation_event_id=causation_event_id,
        operation_context_id=operation_context_id,
        taxonomy_class=tax,
        notification_relevance=rel,
        primary_classification=prim,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload_json=payload or {},
    )
    db.add(row)
    db.flush()
    return row
