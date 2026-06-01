"""epics.start_date / epics.target_date

Revision ID: 0008_epic_start_target_dates
Revises: 0007_epic_test_runs
Create Date: 2026-05-10
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_epic_start_target_dates"
down_revision: Union[str, None] = "0007_epic_test_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("epics", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("epics", sa.Column("target_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("epics", "target_date")
    op.drop_column("epics", "start_date")
