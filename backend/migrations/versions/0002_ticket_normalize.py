"""ticket normalize: title/description/priority/due/author/assignee

Revision ID: 0002_ticket_normalize
Revises: 0001_baseline
Create Date: 2026-05-09
"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_ticket_normalize"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PRIORITY_VALUES = ("critical", "high", "medium", "low")


def upgrade() -> None:
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS title VARCHAR(500)")
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS description TEXT")
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(20)")
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMP NULL")
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_hours INTEGER")
    op.execute(
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS author_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tickets_assignee_id ON tickets(assignee_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tickets_author_id ON tickets(author_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tickets_due_at ON tickets(due_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tickets_status_priority ON tickets(status, priority)"
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, data_json, created_at, status FROM tickets "
            "WHERE title IS NULL OR priority IS NULL"
        )
    ).fetchall()

    user_lookup = {
        row.username.lower(): row.id
        for row in bind.execute(sa.text("SELECT id, username FROM users")).fetchall()
    }

    for row in rows:
        data = row.data_json or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}

        title = (data.get("title") or data.get("subject") or "").strip()
        if not title:
            content = (data.get("content") or "").strip()
            title = content[:80] if content else "(без заголовка)"

        description = data.get("description") or data.get("content") or ""
        priority = (data.get("priority") or "medium").lower()
        if priority not in PRIORITY_VALUES:
            priority = "medium"

        sla_hours = data.get("sla_hours")
        if not isinstance(sla_hours, int):
            try:
                sla_hours = int(sla_hours) if sla_hours else None
            except Exception:
                sla_hours = None
        if sla_hours is None:
            sla_hours = {"critical": 4, "high": 24, "medium": 48, "low": 120}[priority]

        due_at = None
        if row.created_at and sla_hours:
            try:
                base = row.created_at
                if base.tzinfo is None:
                    base = base.replace(tzinfo=timezone.utc)
                due_at = (base + timedelta(hours=sla_hours)).replace(tzinfo=None)
            except Exception:
                due_at = None

        def _resolve(name: str | None) -> int | None:
            if not name:
                return None
            cleaned = str(name).strip().lstrip("@").split(":")[0].lower()
            return user_lookup.get(cleaned)

        author_id = _resolve(data.get("author") or data.get("author_username"))
        assignee_id = _resolve(
            data.get("assignee")
            or data.get("expert")
            or data.get("responder")
            or data.get("target_expert")
        )

        bind.execute(
            sa.text(
                """
                UPDATE tickets
                SET title = :title,
                    description = :description,
                    priority = :priority,
                    sla_hours = :sla_hours,
                    due_at = :due_at,
                    author_id = :author_id,
                    assignee_id = :assignee_id
                WHERE id = :id
                """
            ),
            {
                "id": row.id,
                "title": title[:500],
                "description": description,
                "priority": priority,
                "sla_hours": sla_hours,
                "due_at": due_at,
                "author_id": author_id,
                "assignee_id": assignee_id,
            },
        )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tickets_status_priority")
    op.execute("DROP INDEX IF EXISTS ix_tickets_due_at")
    op.execute("DROP INDEX IF EXISTS ix_tickets_author_id")
    op.execute("DROP INDEX IF EXISTS ix_tickets_assignee_id")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS assignee_id")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS author_id")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS sla_hours")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS due_at")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS priority")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS description")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS title")
