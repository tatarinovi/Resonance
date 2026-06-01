"""Persist one `operation_context` row per correlation id per request lifecycle."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .correlation_context import get_correlation_id, get_http_request_id
from .models import OperationContext


def ensure_operation_context(
    db: Session,
    *,
    actor_id: int | None,
    command_type: str,
    idempotency_key: str | None = None,
) -> OperationContext | None:
    cid = get_correlation_id()
    if not cid:
        return None
    existing = db.scalar(select(OperationContext).where(OperationContext.correlation_id == cid))
    if existing:
        return existing
    row = OperationContext(
        correlation_id=cid,
        actor_id=actor_id,
        command_type=command_type,
        idempotency_key=idempotency_key,
        http_request_id=get_http_request_id(),
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        return row
    except IntegrityError:
        return db.scalar(select(OperationContext).where(OperationContext.correlation_id == cid))
