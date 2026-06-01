"""TTL-style cleanup for high-volume notification subsystem tables."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import DomainEventLog, NotificationDeliveryAttempt

logger = logging.getLogger(__name__)


def purge_old_delivery_attempts(db: Session, *, days: int = 180) -> int:
    cutoff = datetime.utcnow() - timedelta(days=days)
    res = db.execute(delete(NotificationDeliveryAttempt).where(NotificationDeliveryAttempt.created_at < cutoff))
    db.commit()
    n = res.rowcount or 0
    if n:
        logger.info("Purged %s notification_delivery_attempts older than %s days", n, days)
    return n


def purge_old_domain_event_logs(db: Session, *, days: int = 90) -> int:
    cutoff = datetime.utcnow() - timedelta(days=days)
    res = db.execute(delete(DomainEventLog).where(DomainEventLog.occurred_at < cutoff))
    db.commit()
    n = res.rowcount or 0
    if n:
        logger.info("Purged %s domain_event_logs older than %s days", n, days)
    return n
