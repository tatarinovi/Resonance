"""ticket_messages table + backfill from data_json.thread

Revision ID: 0003_ticket_messages
Revises: 0002_ticket_normalize
Create Date: 2026-05-09
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_ticket_messages"
down_revision: Union[str, None] = "0002_ticket_normalize"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_messages (
            id BIGSERIAL PRIMARY KEY,
            ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            kind VARCHAR(20) NOT NULL DEFAULT 'message',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            edited_at TIMESTAMP NULL
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ticket_messages_ticket_created ON ticket_messages(ticket_id, created_at)"
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, data_json, created_at FROM tickets")).fetchall()
    user_lookup = {
        row.username.lower(): row.id
        for row in bind.execute(sa.text("SELECT id, username FROM users")).fetchall()
    }

    insert_stmt = sa.text(
        "INSERT INTO ticket_messages (ticket_id, author_id, body, kind, created_at) "
        "VALUES (:ticket_id, :author_id, :body, :kind, :created_at)"
    )

    def _resolve(name: str | None) -> int | None:
        if not name:
            return None
        cleaned = str(name).strip().lstrip("@").split(":")[0].lower()
        return user_lookup.get(cleaned)

    def _parse_ts(value, fallback) -> datetime:
        if not value:
            return fallback
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        text = str(value).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except Exception:
            return fallback

    for row in rows:
        data = row.data_json or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}

        existing = bind.execute(
            sa.text("SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = :tid"),
            {"tid": row.id},
        ).scalar()
        if existing:
            continue

        thread = data.get("thread") or []
        fallback_created = row.created_at or datetime.utcnow()
        if not thread and data.get("content"):
            thread = [
                {
                    "author": data.get("author"),
                    "text": data.get("content"),
                    "timestamp": fallback_created.isoformat() if hasattr(fallback_created, "isoformat") else None,
                }
            ]

        for index, msg in enumerate(thread):
            if not isinstance(msg, dict):
                continue
            body = (msg.get("text") or msg.get("body") or "").strip()
            if not body:
                continue
            kind = msg.get("role") or msg.get("kind") or "message"
            if kind == "author":
                kind = "message"
            elif kind == "responder":
                kind = "response"
            elif kind not in {"message", "response", "clarification"}:
                kind = "message"
            ts = _parse_ts(msg.get("timestamp") or msg.get("created_at"), fallback_created)
            bind.execute(
                insert_stmt,
                {
                    "ticket_id": row.id,
                    "author_id": _resolve(msg.get("author")),
                    "body": body,
                    "kind": kind,
                    "created_at": ts,
                },
            )

        if data.get("response") and not any(
            (m.get("role") or m.get("kind")) in {"response", "responder"}
            for m in thread
            if isinstance(m, dict)
        ):
            ts = _parse_ts(data.get("responded_at"), fallback_created)
            bind.execute(
                insert_stmt,
                {
                    "ticket_id": row.id,
                    "author_id": _resolve(data.get("responder")),
                    "body": data["response"],
                    "kind": "response",
                    "created_at": ts,
                },
            )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ticket_messages_ticket_created")
    op.execute("DROP TABLE IF EXISTS ticket_messages")
