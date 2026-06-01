"""epic_blockers table + backfill from EpicQA.blockers

Revision ID: 0006_epic_blockers
Revises: 0005_ticket_events
Create Date: 2026-05-09
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_epic_blockers"
down_revision: Union[str, None] = "0005_ticket_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS epic_blockers (
            id BIGSERIAL PRIMARY KEY,
            epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
            reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            resolved_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_epic_blockers_epic_id ON epic_blockers(epic_id)"
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT epic_id, blockers FROM epic_qa WHERE blockers IS NOT NULL AND blockers <> ''")
    ).fetchall()

    insert_stmt = sa.text(
        "INSERT INTO epic_blockers (epic_id, body, created_at) "
        "VALUES (:epic_id, :body, CURRENT_TIMESTAMP)"
    )

    for row in rows:
        existing = bind.execute(
            sa.text("SELECT COUNT(*) FROM epic_blockers WHERE epic_id = :eid"),
            {"eid": row.epic_id},
        ).scalar()
        if existing:
            continue
        text = (row.blockers or "").strip()
        if not text:
            continue
        for chunk in [c.strip() for c in text.replace(";", "\n").split("\n") if c.strip()]:
            bind.execute(insert_stmt, {"epic_id": row.epic_id, "body": chunk})


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_epic_blockers_epic_id")
    op.execute("DROP TABLE IF EXISTS epic_blockers")
