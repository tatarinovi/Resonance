"""kanban_legacy_task_seen — baseline snapshot for legacy task polling.

Revision ID: 0013_kanban_legacy_task_seen
Revises: 0012_semantic_delivery_channels
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "0013_kanban_legacy_task_seen"
down_revision: Union[str, None] = "0012_semantic_delivery_channels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kanban_legacy_task_seen",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kanban_user_id", sa.Integer(), nullable=False),
        sa.Column("seen_task_ids", sa.JSON(), nullable=False, server_default=text("'[]'::json")),
        sa.Column("initialized_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "ix_kanban_legacy_task_seen_kanban_user_id",
        "kanban_legacy_task_seen",
        ["kanban_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_kanban_legacy_task_seen_kanban_user_id", table_name="kanban_legacy_task_seen")
    op.drop_table("kanban_legacy_task_seen")
