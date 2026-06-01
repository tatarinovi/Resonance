"""ticket_attachments table + backfill from data_json.attachments

Revision ID: 0004_ticket_attachments
Revises: 0003_ticket_messages
Create Date: 2026-05-09
"""
from __future__ import annotations

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_ticket_attachments"
down_revision: Union[str, None] = "0003_ticket_messages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_attachments (
            id BIGSERIAL PRIMARY KEY,
            ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            message_id BIGINT REFERENCES ticket_messages(id) ON DELETE SET NULL,
            uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
            size_bytes BIGINT NOT NULL DEFAULT 0,
            url VARCHAR(1024) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ticket_attachments_ticket_id ON ticket_attachments(ticket_id)"
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, data_json FROM tickets")).fetchall()

    insert_stmt = sa.text(
        "INSERT INTO ticket_attachments (ticket_id, name, mime_type, size_bytes, url, created_at) "
        "VALUES (:ticket_id, :name, :mime_type, :size_bytes, :url, CURRENT_TIMESTAMP)"
    )

    for row in rows:
        data = row.data_json or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}

        existing = bind.execute(
            sa.text("SELECT COUNT(*) FROM ticket_attachments WHERE ticket_id = :tid"),
            {"tid": row.id},
        ).scalar()
        if existing:
            continue

        attachments: list[dict] = []
        for key in ("attachments", "response_attachments"):
            for raw in data.get(key) or []:
                if isinstance(raw, dict):
                    attachments.append(raw)
                elif isinstance(raw, str):
                    attachments.append({"url": raw, "name": raw.split("/")[-1] or "attachment"})

        for attachment in attachments:
            url = (attachment.get("url") or "").strip()
            if not url:
                continue
            name = (attachment.get("name") or url.split("/")[-1] or "attachment").strip()[:255]
            mime_type = (attachment.get("mime_type") or attachment.get("type") or "application/octet-stream")[:100]
            size_bytes = int(attachment.get("size") or attachment.get("size_bytes") or 0)
            bind.execute(
                insert_stmt,
                {
                    "ticket_id": row.id,
                    "name": name,
                    "mime_type": mime_type,
                    "size_bytes": size_bytes,
                    "url": url[:1024],
                },
            )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ticket_attachments_ticket_id")
    op.execute("DROP TABLE IF EXISTS ticket_attachments")
