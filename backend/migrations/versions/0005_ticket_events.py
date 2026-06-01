"""ticket_events table + backfill from data_json.history

Revision ID: 0005_ticket_events
Revises: 0004_ticket_attachments
Create Date: 2026-05-09
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_ticket_events"
down_revision: Union[str, None] = "0004_ticket_attachments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


KIND_MAP = {
    "created": "created",
    "status_change": "status_changed",
    "status_changed": "status_changed",
    "content_edit": "description_changed",
    "comment": "message_added",
    "message": "message_added",
    "assignee": "assignee_changed",
    "priority": "priority_changed",
    "attachment": "attachment_added",
}


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_events (
            id BIGSERIAL PRIMARY KEY,
            ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            kind VARCHAR(40) NOT NULL,
            old_value TEXT,
            new_value TEXT,
            comment TEXT,
            payload_json JSON,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ticket_events_ticket_created ON ticket_events(ticket_id, created_at)"
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, data_json, created_at FROM tickets")).fetchall()
    user_lookup = {
        row.username.lower(): row.id
        for row in bind.execute(sa.text("SELECT id, username FROM users")).fetchall()
    }

    def _resolve(name: str | None) -> int | None:
        if not name:
            return None
        cleaned = str(name).strip().lstrip("@").split(":")[0].lower()
        return user_lookup.get(cleaned)

    def _parse_ts(value, fallback: datetime) -> datetime:
        if not value:
            return fallback
        if isinstance(value, datetime):
            return value.replace(tzinfo=None) if value.tzinfo else value
        text = str(value).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except Exception:
            return fallback

    insert_stmt = sa.text(
        "INSERT INTO ticket_events (ticket_id, actor_id, kind, old_value, new_value, comment, created_at) "
        "VALUES (:ticket_id, :actor_id, :kind, :old_value, :new_value, :comment, :created_at)"
    )

    for row in rows:
        data = row.data_json or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}

        existing = bind.execute(
            sa.text("SELECT COUNT(*) FROM ticket_events WHERE ticket_id = :tid"),
            {"tid": row.id},
        ).scalar()
        if existing:
            continue

        history = data.get("history") or []
        fallback_created = row.created_at or datetime.utcnow()

        if not history:
            bind.execute(
                insert_stmt,
                {
                    "ticket_id": row.id,
                    "actor_id": _resolve(data.get("author")),
                    "kind": "created",
                    "old_value": None,
                    "new_value": None,
                    "comment": None,
                    "created_at": fallback_created,
                },
            )
            continue

        for raw in history:
            if not isinstance(raw, dict):
                continue
            raw_kind = (raw.get("type") or raw.get("kind") or "").strip().lower()
            kind = KIND_MAP.get(raw_kind, raw_kind or "event")
            ts = _parse_ts(raw.get("time") or raw.get("created_at"), fallback_created)
            bind.execute(
                insert_stmt,
                {
                    "ticket_id": row.id,
                    "actor_id": _resolve(raw.get("author") or raw.get("user")),
                    "kind": kind[:40],
                    "old_value": str(raw.get("old"))[:1000] if raw.get("old") is not None else None,
                    "new_value": str(raw.get("new"))[:1000] if raw.get("new") is not None else None,
                    "comment": raw.get("comment"),
                    "created_at": ts,
                },
            )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ticket_events_ticket_created")
    op.execute("DROP TABLE IF EXISTS ticket_events")
