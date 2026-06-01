"""Outbound notification queue: enqueue Matrix/Telegram jobs and async worker."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .aggregation import MATRIX_DEBOUNCE_BUCKET_SECONDS
from .correlation_context import get_correlation_id
from .database import SessionLocal
from .matrix_service import matrix_bot
from .models import (
    NotificationDeliveryAttempt,
    NotificationOutboundJob,
    ProjectNotificationPolicy,
    User,
)
from .notification_policy_service import get_effective_policy
from .telegram_service import telegram_service

logger = logging.getLogger(__name__)

CHANNEL_MATRIX_DM = "matrix_dm"
CHANNEL_MATRIX_ROOM = "matrix_room"
CHANNEL_TELEGRAM = "telegram"

MAX_ATTEMPTS = 8
BASE_BACKOFF_SECONDS = 30


def build_idempotency_key(*parts: str, max_len: int = 72) -> str:
    raw = ":".join(str(p) for p in parts if p is not None)
    if len(raw) <= max_len:
        return raw
    return hashlib.sha256(raw.encode()).hexdigest()[:max_len]


def enqueue_outbound_job(
    db: Session,
    *,
    channel: str,
    destination_ref: str,
    payload_html: str,
    notification_id: int | None,
    recipient_user_id: int | None,
    correlation_id: str | None,
    operation_context_id: int | None,
    idempotency_key: str,
    debounce_matrix: bool = False,
    delivery_target_type: str = "personal",
    delivery_intent: str = "personal_info",
    routing_reason: str | None = None,
) -> NotificationOutboundJob | None:
    """Insert a pending job; duplicates on idempotency_key are ignored (nested tx)."""
    now = datetime.utcnow()
    next_at = now
    if debounce_matrix and channel in {CHANNEL_MATRIX_DM, CHANNEL_MATRIX_ROOM}:
        b = MATRIX_DEBOUNCE_BUCKET_SECONDS
        boundary = (int(now.timestamp()) // b + 1) * b
        next_at = datetime.utcfromtimestamp(boundary)

    row = NotificationOutboundJob(
        notification_id=notification_id,
        recipient_user_id=recipient_user_id,
        channel=channel,
        destination_ref=destination_ref,
        payload_html=payload_html,
        status="pending",
        correlation_id=correlation_id or get_correlation_id(),
        operation_context_id=operation_context_id,
        idempotency_key=idempotency_key[:72],
        delivery_target_type=delivery_target_type,
        delivery_intent=delivery_intent,
        routing_reason=routing_reason,
        next_attempt_at=next_at,
    )
    db.add(row)
    try:
        with db.begin_nested():
            db.flush()
        logger.info(
            "outbound_route nid=%s intent=%s target=%s channel=%s reason=%s",
            notification_id,
            delivery_intent,
            delivery_target_type,
            channel,
            routing_reason or "",
        )
        return row
    except IntegrityError:
        logger.debug("Deduped outbound job key=%s", idempotency_key)
        return None


def enqueue_matrix_dm_for_user(
    db: Session,
    *,
    user: User,
    html: str,
    notification_id: int | None,
    operation_context_id: int | None,
    correlation_id: str | None,
    idempotency_suffix: str,
    debounce: bool = True,
    override_matrix_mxid: str | None = None,
    delivery_target_type: str = "personal",
    delivery_intent: str = "personal_info",
    routing_reason: str | None = None,
) -> None:
    primary_mxid = (override_matrix_mxid or user.matrix_id or "").strip()
    if not primary_mxid:
        return
    if not override_matrix_mxid and not user.matrix_dm_enabled:
        return
    mid = primary_mxid
    dest = user.matrix_dm_room_id.strip() if user.matrix_dm_room_id else mid
    cid = correlation_id or get_correlation_id() or "none"
    enqueue_outbound_job(
        db,
        channel=CHANNEL_MATRIX_DM,
        destination_ref=dest,
        payload_html=html,
        notification_id=notification_id,
        recipient_user_id=user.id,
        correlation_id=cid,
        operation_context_id=operation_context_id,
        idempotency_key=build_idempotency_key("mxdm", str(notification_id or 0), str(user.id), cid, idempotency_suffix),
        debounce_matrix=debounce,
        delivery_target_type=delivery_target_type,
        delivery_intent=delivery_intent,
        routing_reason=routing_reason,
    )


def enqueue_matrix_room_message(
    db: Session,
    *,
    room_id: str,
    html: str,
    notification_id: int | None,
    project_id: int | None,
    operation_context_id: int | None,
    correlation_id: str | None,
    idempotency_suffix: str,
    debounce: bool = True,
    delivery_target_type: str = "broadcast",
    delivery_intent: str = "team_awareness",
    routing_reason: str | None = None,
) -> None:
    policy = get_effective_policy(db, project_id) if project_id is not None else None
    if policy is not None and not policy.realtime_matrix_room_enabled:
        return
    if policy is not None and policy.matrix_room_encryption_blocked:
        logger.warning("Skipping Matrix room send: encryption_blocked project=%s", project_id)
        return

    cid = correlation_id or get_correlation_id() or "none"
    enqueue_outbound_job(
        db,
        channel=CHANNEL_MATRIX_ROOM,
        destination_ref=room_id,
        payload_html=html,
        notification_id=notification_id,
        recipient_user_id=None,
        correlation_id=cid,
        operation_context_id=operation_context_id,
        idempotency_key=build_idempotency_key("mxroom", room_id, str(notification_id or 0), cid, idempotency_suffix),
        debounce_matrix=debounce,
        delivery_target_type=delivery_target_type,
        delivery_intent=delivery_intent,
        routing_reason=routing_reason,
    )


def enqueue_telegram_for_user(
    db: Session,
    *,
    user: User,
    html: str,
    notification_id: int | None,
    operation_context_id: int | None,
    correlation_id: str | None,
    idempotency_suffix: str,
    delivery_target_type: str = "personal",
    delivery_intent: str = "personal_info",
    routing_reason: str | None = None,
) -> None:
    if not user.telegram_notifications or not (user.telegram_id or "").strip():
        return
    cid = correlation_id or get_correlation_id() or "none"
    enqueue_outbound_job(
        db,
        channel=CHANNEL_TELEGRAM,
        destination_ref=user.telegram_id.strip(),
        payload_html=html,
        notification_id=notification_id,
        recipient_user_id=user.id,
        correlation_id=cid,
        operation_context_id=operation_context_id,
        idempotency_key=build_idempotency_key("tg", str(notification_id or 0), str(user.id), cid, idempotency_suffix),
        debounce_matrix=False,
        delivery_target_type=delivery_target_type,
        delivery_intent=delivery_intent,
        routing_reason=routing_reason,
    )


def _matrix_mention_html(matrix_id: str, label: str | None = None) -> str:
    visible = label or matrix_id
    return f"<a href='https://matrix.to/#/{matrix_id}'>{visible}</a>"


def with_matrix_mention(message: str, matrix_id: str, label: str | None = None) -> str:
    return f"{_matrix_mention_html(matrix_id, label)}\n\n{message}"


def _append_attempt(db: Session, job: NotificationOutboundJob, attempt_no: int, status: str, detail: str | None) -> None:
    db.add(
        NotificationDeliveryAttempt(
            job_id=job.id,
            attempt_no=attempt_no,
            status=status,
            detail=detail,
        )
    )


def _mark_room_encryption_blocked(db: Session, room_id: str) -> None:
    stmt = select(ProjectNotificationPolicy).where(ProjectNotificationPolicy.matrix_project_room_id == room_id)
    pol = db.scalar(stmt)
    if pol:
        pol.matrix_room_encryption_blocked = True
        pol.updated_at = datetime.utcnow()


async def _deliver_job(db: Session, job: NotificationOutboundJob) -> None:
    now = datetime.utcnow()
    attempt_no = job.attempt_count + 1
    job.attempt_count = attempt_no
    job.updated_at = now

    try:
        if job.channel == CHANNEL_MATRIX_DM:
            user = db.get(User, job.recipient_user_id) if job.recipient_user_id else None
            matrix_message = job.payload_html
            if user and user.matrix_id:
                matrix_message = with_matrix_mention(job.payload_html, user.matrix_id, user.username)
            dest = job.destination_ref.strip()
            if dest.startswith("!") or dest.startswith("#"):
                await matrix_bot.send_room(dest, matrix_message)
            else:
                await matrix_bot.send_dm(dest, matrix_message)
        elif job.channel == CHANNEL_MATRIX_ROOM:
            try:
                await matrix_bot.send_room(job.destination_ref, job.payload_html)
            except httpx.HTTPStatusError as exc:
                body = (exc.response.text or "").lower()
                if exc.response.status_code == 403 or "encryption" in body or "m_room_encrypted" in body:
                    _mark_room_encryption_blocked(db, job.destination_ref)
                    raise
                raise
        elif job.channel == CHANNEL_TELEGRAM:
            user = db.get(User, job.recipient_user_id) if job.recipient_user_id else None
            if not user:
                raise RuntimeError("telegram job missing recipient_user_id")
            await telegram_service.send_notification(user, job.payload_html)
        else:
            raise RuntimeError(f"unknown channel {job.channel}")

        job.status = "sent"
        job.last_error = None
        _append_attempt(db, job, attempt_no, "sent", None)

        if job.channel == CHANNEL_MATRIX_ROOM and job.destination_ref:
            stmt = select(ProjectNotificationPolicy).where(ProjectNotificationPolicy.matrix_project_room_id == job.destination_ref)
            pol = db.scalar(stmt)
            if pol:
                pol.matrix_room_last_success_at = datetime.utcnow()
                pol.matrix_room_encryption_blocked = False

    except Exception as exc:
        err = str(exc)[:2000]
        job.last_error = err
        _append_attempt(db, job, attempt_no, "failed", err)
        if attempt_no >= MAX_ATTEMPTS:
            job.status = "dead_letter"
        else:
            job.status = "pending"
            backoff = min(BASE_BACKOFF_SECONDS * (2 ** (attempt_no - 1)), 3600)
            job.next_attempt_at = datetime.utcnow() + timedelta(seconds=backoff)
        logger.warning("Outbound job %s failed (%s): %s", job.id, job.channel, err)


async def process_pending_outbound_jobs(*, limit: int = 25) -> int:
    ids: list[int] = []
    with SessionLocal() as db:
        stmt = (
            select(NotificationOutboundJob)
            .where(
                NotificationOutboundJob.status == "pending",
                NotificationOutboundJob.next_attempt_at <= datetime.utcnow(),
            )
            .order_by(NotificationOutboundJob.next_attempt_at.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        jobs = list(db.scalars(stmt).all())
        if not jobs:
            return 0
        for job in jobs:
            job.status = "processing"
            job.updated_at = datetime.utcnow()
            ids.append(job.id)
        db.commit()

    for jid in ids:
        with SessionLocal() as job_db:
            row = job_db.get(NotificationOutboundJob, jid)
            if not row or row.status != "processing":
                continue
            await _deliver_job(job_db, row)
            job_db.commit()
    return len(ids)
