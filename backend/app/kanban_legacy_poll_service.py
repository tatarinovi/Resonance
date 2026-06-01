"""Poll DS Kanban `GET /user/{id}/task/legacy` per Resonance user (own token) and notify on new task ids."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal
from .kanban_client import KanbanClient
from .models import KanbanLegacyTaskSeen, NotificationType, User
from .notification_helpers import create_notification

logger = logging.getLogger(__name__)


def _task_id_from_legacy_row(row: dict[str, Any]) -> int | None:
    raw = row.get("id")
    try:
        tid = int(raw)
    except (TypeError, ValueError):
        return None
    return tid if tid > 0 else None


def _project_slug_from_row(row: dict[str, Any], id_to_slug: dict[int, str]) -> str | None:
    p = row.get("project")
    if not isinstance(p, dict):
        return None
    slug = p.get("slug")
    if isinstance(slug, str) and slug.strip():
        return slug.strip()
    pid = p.get("id")
    try:
        pid_int = int(pid)
    except (TypeError, ValueError):
        return None
    if pid_int > 0:
        return id_to_slug.get(pid_int)
    return None


def _resonance_kanban_task_url(project_slug: str | None, task_id: int) -> str:
    """In-app board URL (slug in path, task id in query — см. KanbanBoardView `?task=`)."""
    base = get_settings().frontend_url.rstrip("/")
    if project_slug and project_slug.strip():
        enc = quote(project_slug.strip(), safe="")
        return f"{base}/admin/kanban/projects/{enc}?task={int(task_id)}"
    return f"{base}/admin/kanban/projects"


def _seen_id_set(raw: Any) -> set[int]:
    out: set[int] = set()
    if not isinstance(raw, list):
        return out
    for x in raw:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out.add(n)
    return out


def _poll_one_user(db: Session, user: User) -> None:
    token = (user.kanban_token or "").strip()
    if not token:
        return

    client = KanbanClient(token=token)
    try:
        with client.pooled_http():
            me = client.current_user()
            kid = int(me.get("id") or 0)
            if kid <= 0:
                logger.warning("Kanban legacy poll: no DS user id (auth/user) for resonance user_id=%s", user.id)
                return
            tasks = client.user_tasks_legacy(kid)
            plist = client.projects()
    except HTTPException as exc:
        logger.warning("Kanban legacy poll DS error user_id=%s: %s", user.id, exc.detail)
        return

    id_to_slug: dict[int, str] = {}
    for item in plist:
        if not isinstance(item, dict):
            continue
        try:
            pid = int(item.get("id") or 0)
        except (TypeError, ValueError):
            continue
        slug = item.get("slug")
        if pid > 0 and isinstance(slug, str) and slug.strip():
            id_to_slug[pid] = slug.strip()

    current_ids: set[int] = set()
    rows_by_id: dict[int, dict[str, Any]] = {}
    for row in tasks:
        if not isinstance(row, dict):
            continue
        tid = _task_id_from_legacy_row(row)
        if tid:
            current_ids.add(tid)
            rows_by_id[tid] = row

    snap = db.get(KanbanLegacyTaskSeen, user.id)
    if snap is None:
        db.add(
            KanbanLegacyTaskSeen(
                user_id=user.id,
                kanban_user_id=kid,
                seen_task_ids=sorted(current_ids),
                initialized_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        )
        db.commit()
        return

    seen_before = _seen_id_set(snap.seen_task_ids)
    new_ids = sorted(current_ids - seen_before)

    for tid in new_ids:
        task_row = rows_by_id.get(tid, {})
        slug = _project_slug_from_row(task_row, id_to_slug)
        title = str(task_row.get("name") or task_row.get("title") or "").strip() or f"Задача #{tid}"
        body = f"{title}" + (f" · {slug}" if slug else "")
        target_url = _resonance_kanban_task_url(slug, tid)
        dedupe_key = f"kanban:legacy:u{user.id}:task:{tid}"
        meta: dict[str, Any] = {"kanban_user_id": kid, "task_id": tid}
        if slug:
            meta["project_slug"] = slug
        create_notification(
            db,
            recipient_id=user.id,
            type=NotificationType.KANBAN_TASK_NEW.value,
            title="Новая задача в Kanban",
            body=body,
            target_type="kanban_task",
            target_id=tid,
            target_url=target_url,
            dedupe_key=dedupe_key,
            metadata_json=meta,
        )

    snap = db.get(KanbanLegacyTaskSeen, user.id)
    if snap:
        snap.kanban_user_id = kid
        snap.seen_task_ids = sorted(seen_before | current_ids)
        snap.updated_at = datetime.utcnow()
        db.commit()


def kanban_legacy_poll_once() -> None:
    with SessionLocal() as db:
        users = list(db.scalars(select(User).where(User.kanban_token.isnot(None))).all())
        for user in users:
            try:
                _poll_one_user(db, user)
            except Exception:
                logger.exception("Kanban legacy poll failed for user_id=%s", user.id)
