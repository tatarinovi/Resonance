"""epic_test_runs table + backfill from EpicQA.test_run_*_url

Revision ID: 0007_epic_test_runs
Revises: 0006_epic_blockers
Create Date: 2026-05-09
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_epic_test_runs"
down_revision: Union[str, None] = "0006_epic_blockers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


STAGE_TO_COMPLETE = {
    "test": {"test_complete", "stage_complete", "prod_complete", "closed"},
    "stage": {"stage_complete", "prod_complete", "closed"},
    "prod": {"prod_complete", "closed"},
}


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS epic_test_runs (
            id BIGSERIAL PRIMARY KEY,
            epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
            environment VARCHAR(10) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'planned',
            url VARCHAR(1024),
            started_at TIMESTAMP NULL,
            finished_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_epic_test_runs_epic_id ON epic_test_runs(epic_id)"
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT epic_id, status, test_run_test_url, test_run_stage_url, test_run_prod_url "
            "FROM epic_qa "
            "WHERE test_run_test_url IS NOT NULL OR test_run_stage_url IS NOT NULL OR test_run_prod_url IS NOT NULL"
        )
    ).fetchall()

    insert_stmt = sa.text(
        "INSERT INTO epic_test_runs (epic_id, environment, status, url) "
        "VALUES (:epic_id, :environment, :status, :url)"
    )

    for row in rows:
        existing = bind.execute(
            sa.text("SELECT COUNT(*) FROM epic_test_runs WHERE epic_id = :eid"),
            {"eid": row.epic_id},
        ).scalar()
        if existing:
            continue

        qa_status = (row.status or "").lower()

        for env, url in [
            ("test", row.test_run_test_url),
            ("stage", row.test_run_stage_url),
            ("prod", row.test_run_prod_url),
        ]:
            if not url:
                continue
            done = qa_status in STAGE_TO_COMPLETE.get(env, set())
            run_status = "passed" if done else "running"
            bind.execute(
                insert_stmt,
                {
                    "epic_id": row.epic_id,
                    "environment": env,
                    "status": run_status,
                    "url": url[:1024],
                },
            )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_epic_test_runs_epic_id")
    op.execute("DROP TABLE IF EXISTS epic_test_runs")
