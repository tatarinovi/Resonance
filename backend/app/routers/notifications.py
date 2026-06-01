from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Notification, User
from ..schemas import ApiDatetime

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationRead(BaseModel):
    id: int
    type: str
    title: str
    body: str
    target_type: str
    target_id: int
    target_url: str
    is_read: bool
    read_at: ApiDatetime | None = None
    created_at: ApiDatetime
    lifecycle_status: str = "unread"
    severity: str = "normal"
    urgency: str = "passive"
    correlation_id: str | None = None
    project_id: int | None = None
    muted: bool = False
    snooze_until: ApiDatetime | None = None

    model_config = ConfigDict(from_attributes=True)


class NotificationPaginationResponse(BaseModel):
    items: list[NotificationRead]
    total: int
    page: int
    page_size: int


class DeliveryHealthRead(BaseModel):
    matrix_dm_enabled: bool
    matrix_id_configured: bool
    telegram_notifications_enabled: bool
    telegram_configured: bool
    issues: list[str]


@router.get("", response_model=NotificationPaginationResponse)
def get_notifications(
    include_read: bool = True,
    limit: int | None = Query(default=None, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPaginationResponse:
    stmt = select(Notification).where(Notification.recipient_id == user.id)
    if not include_read:
        stmt = stmt.where(Notification.is_read == False)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    effective_page_size = min(limit, 100) if limit is not None else page_size
    stmt = stmt.order_by(Notification.created_at.desc()).offset((page - 1) * effective_page_size).limit(effective_page_size)
    return NotificationPaginationResponse(
        items=list(db.scalars(stmt).all()),
        total=total,
        page=page,
        page_size=effective_page_size,
    )


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Notification:
    notification = db.get(Notification, notification_id)
    if not notification or notification.recipient_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.utcnow()
        notification.lifecycle_status = "read"
        db.commit()
        db.refresh(notification)

    return notification


@router.post("/read-all")
def mark_all_notifications_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    notifications = list(db.scalars(
        select(Notification).where(Notification.recipient_id == user.id, Notification.is_read == False)
    ).all())

    now = datetime.utcnow()
    for notification in notifications:
        notification.is_read = True
        notification.read_at = now
        notification.lifecycle_status = "read"

    db.commit()
    return {"updated": len(notifications)}


@router.get("/delivery-health", response_model=DeliveryHealthRead)
def notification_delivery_health(user: User = Depends(get_current_user)) -> DeliveryHealthRead:
    settings = get_settings()
    matrix_on = settings.matrix_dm_enabled and bool(user.matrix_dm_enabled)
    matrix_ok = bool(user.matrix_id and user.matrix_id.strip())
    tg_on = settings.telegram_enabled and bool(user.telegram_notifications)
    tg_ok = bool(user.telegram_id and str(user.telegram_id).strip())
    issues: list[str] = []
    if matrix_on and not matrix_ok:
        issues.append("Включены уведомления Matrix, но Matrix ID не указан в профиле.")
    if tg_on and not tg_ok:
        issues.append("Включены уведомления Telegram, но chat_id/username не привязан.")
    return DeliveryHealthRead(
        matrix_dm_enabled=matrix_on,
        matrix_id_configured=matrix_ok,
        telegram_notifications_enabled=tg_on,
        telegram_configured=tg_ok,
        issues=issues,
    )


@router.post("/{notification_id}/acknowledge", response_model=NotificationRead)
def acknowledge_notification(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Notification:
    notification = db.get(Notification, notification_id)
    if not notification or notification.recipient_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.acknowledged_at = datetime.utcnow()
    notification.lifecycle_status = "acknowledged"
    db.commit()
    db.refresh(notification)
    return notification
