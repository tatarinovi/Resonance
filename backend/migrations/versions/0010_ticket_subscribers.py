"""ticket_subscribers

Revision ID: 0010_ticket_subscribers
Revises: 0009_user_last_login_at
Create Date: 2026-05-10
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_ticket_subscribers"
down_revision: Union[str, None] = "0009_user_last_login_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ticket_subscribers",
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("ticket_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("ticket_subscribers")
