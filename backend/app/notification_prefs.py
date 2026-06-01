"""User notification preferences helpers (personal channel mode, etc.)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import UserNotificationPreferences

VALID_PERSONAL_CHANNEL_MODES: frozenset[str] = frozenset(
    {"in_app_only", "matrix_preferred", "telegram_preferred", "both"}
)
DEFAULT_PERSONAL_CHANNEL_MODE = "both"


def get_personal_channel_mode(db: Session, user_id: int) -> str:
    row = db.get(UserNotificationPreferences, user_id)
    mode = getattr(row, "personal_channel_mode", None) if row else None
    if not mode or mode not in VALID_PERSONAL_CHANNEL_MODES:
        return DEFAULT_PERSONAL_CHANNEL_MODE
    return mode


def ensure_personal_channel_mode(db: Session, user_id: int, mode: str) -> UserNotificationPreferences:
    if mode not in VALID_PERSONAL_CHANNEL_MODES:
        raise ValueError("invalid personal_channel_mode")
    row = db.get(UserNotificationPreferences, user_id)
    if row is None:
        row = UserNotificationPreferences(user_id=user_id, personal_channel_mode=mode)
        db.add(row)
    else:
        row.personal_channel_mode = mode
    return row
