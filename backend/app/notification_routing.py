"""Deterministic personal vs broadcast outbound routing (intent × user preference × availability).

No personal→project-room fallback: operational intents stay on personal surfaces or in-app only.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .correlation_context import get_correlation_id
from .config import get_settings
from .domain_events.catalog import DeliveryIntent, notification_delivery_defaults
from .models import User
from .notification_outbound import enqueue_matrix_dm_for_user, enqueue_matrix_room_message, enqueue_telegram_for_user
from .notification_prefs import get_personal_channel_mode

logger = logging.getLogger(__name__)

DELIVERY_TARGET_PERSONAL = "personal"
DELIVERY_TARGET_BROADCAST = "broadcast"


def matrix_dm_debounce_for_intent(intent_value: str) -> bool:
    return intent_value in {
        DeliveryIntent.PERSONAL_INFO.value,
        DeliveryIntent.TEAM_AWARENESS.value,
    }


def matrix_room_debounce_for_intent(intent_value: str) -> bool:
    return intent_value in {
        DeliveryIntent.TEAM_AWARENESS.value,
        DeliveryIntent.DIGEST.value,
    }


def _matrix_dm_eligible(user: User, override_matrix_mxid: str | None) -> bool:
    settings = get_settings()
    mxid = override_matrix_mxid or user.matrix_id
    return settings.matrix_dm_enabled and bool(mxid and str(mxid).strip())


def _telegram_eligible(user: User) -> bool:
    settings = get_settings()
    return settings.telegram_enabled and bool(user.telegram_id and str(user.telegram_id).strip())


def _want_secondary_personal_channel(mode: str, intent: DeliveryIntent, severity: str) -> bool:
    if mode not in {"matrix_preferred", "telegram_preferred"}:
        return False
    if intent == DeliveryIntent.ESCALATION:
        return True
    return severity in {"high", "critical"}


def enqueue_personal_delivery(
    db: Session,
    *,
    user: User | None,
    notification_type: str,
    notification_id: int | None,
    severity: str,
    html: str,
    matrix_override_mxid: str | None,
    operation_context_id: int | None,
    correlation_id: str | None,
    idempotency_suffix: str | None = None,
    debounce_matrix_override: bool | None = None,
) -> None:
    """Enqueue Matrix DM / Telegram jobs per user preference; never falls back to project rooms."""
    if not user:
        return

    defaults = notification_delivery_defaults(notification_type)
    intent_val = defaults.delivery_intent.value
    debounce_mx = (
        debounce_matrix_override
        if debounce_matrix_override is not None
        else matrix_dm_debounce_for_intent(intent_val)
    )

    mode = get_personal_channel_mode(db, user.id)
    cid = correlation_id or get_correlation_id() or "none"
    suffix = idempotency_suffix or str(notification_id or "na")

    mx_ok = _matrix_dm_eligible(user, matrix_override_mxid)
    tg_ok = _telegram_eligible(user)

    if mode == "in_app_only":
        logger.info(
            "outbound_route nid=%s intent=%s target=%s channel=%s reason=%s",
            notification_id,
            intent_val,
            DELIVERY_TARGET_PERSONAL,
            "none",
            "skip_in_app_only",
        )
        return

    secondary = _want_secondary_personal_channel(mode, defaults.delivery_intent, severity)

    def dm(reason: str, *, idem_suffix: str | None = None) -> None:
        enqueue_matrix_dm_for_user(
            db,
            user=user,
            html=html,
            notification_id=notification_id,
            operation_context_id=operation_context_id,
            correlation_id=cid,
            idempotency_suffix=idem_suffix or suffix,
            debounce=debounce_mx,
            override_matrix_mxid=matrix_override_mxid,
            delivery_target_type=DELIVERY_TARGET_PERSONAL,
            delivery_intent=intent_val,
            routing_reason=reason,
        )

    def tg(reason: str, *, idem_suffix: str | None = None) -> None:
        enqueue_telegram_for_user(
            db,
            user=user,
            html=html,
            notification_id=notification_id,
            operation_context_id=operation_context_id,
            correlation_id=cid,
            idempotency_suffix=idem_suffix or suffix,
            delivery_target_type=DELIVERY_TARGET_PERSONAL,
            delivery_intent=intent_val,
            routing_reason=reason,
        )

    if mode == "both":
        if mx_ok:
            dm("both_personal_matrix")
        if tg_ok:
            tg("both_personal_telegram")
        if not mx_ok and not tg_ok:
            logger.info(
                "outbound_route nid=%s intent=%s target=%s channel=%s reason=%s",
                notification_id,
                intent_val,
                DELIVERY_TARGET_PERSONAL,
                "none",
                "no_personal_transport_available",
            )
        return

    if mode == "matrix_preferred":
        if mx_ok:
            dm("preference_matrix_first")
            if tg_ok and secondary:
                tg("secondary_escalation_or_high_severity_telegram", idem_suffix=f"{suffix}:tg_secondary")
        elif tg_ok:
            tg("fallback_personal_no_matrix")
        else:
            logger.info(
                "outbound_route nid=%s intent=%s target=%s channel=%s reason=%s",
                notification_id,
                intent_val,
                DELIVERY_TARGET_PERSONAL,
                "none",
                "no_personal_transport_available",
            )
        return

    if mode == "telegram_preferred":
        if tg_ok:
            tg("preference_telegram_first")
            if mx_ok and secondary:
                dm("secondary_escalation_or_high_severity_matrix", idem_suffix=f"{suffix}:mx_secondary")
        elif mx_ok:
            dm("fallback_personal_no_telegram")
        else:
            logger.info(
                "outbound_route nid=%s intent=%s target=%s channel=%s reason=%s",
                notification_id,
                intent_val,
                DELIVERY_TARGET_PERSONAL,
                "none",
                "no_personal_transport_available",
            )
        return


def enqueue_broadcast_matrix_room(
    db: Session,
    *,
    room_id: str,
    html: str,
    notification_id: int | None,
    project_id: int | None,
    operation_context_id: int | None,
    correlation_id: str | None,
    idempotency_suffix: str,
    broadcast_intent_value: str,
    routing_reason: str,
    debounce: bool | None = None,
) -> None:
    """Team awareness / digest style broadcast to a Matrix room (never a substitute for personal delivery)."""
    cid = correlation_id or get_correlation_id() or "none"
    deb = debounce if debounce is not None else matrix_room_debounce_for_intent(broadcast_intent_value)
    enqueue_matrix_room_message(
        db,
        room_id=room_id,
        html=html,
        notification_id=notification_id,
        project_id=project_id,
        operation_context_id=operation_context_id,
        correlation_id=cid,
        idempotency_suffix=idempotency_suffix,
        debounce=deb,
        delivery_target_type=DELIVERY_TARGET_BROADCAST,
        delivery_intent=broadcast_intent_value,
        routing_reason=routing_reason,
    )
