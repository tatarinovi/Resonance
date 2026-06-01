"""Semantic delivery: outbound job classification, notification intent denorm, personal_channel_mode.

Revision ID: 0012_semantic_delivery_channels
Revises: 0011_notification_architecture
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_semantic_delivery_channels"
down_revision: Union[str, None] = "0011_notification_architecture"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_outbound_jobs",
        sa.Column("delivery_target_type", sa.String(length=20), nullable=False, server_default="personal"),
    )
    op.add_column(
        "notification_outbound_jobs",
        sa.Column("delivery_intent", sa.String(length=40), nullable=False, server_default="personal_info"),
    )
    op.add_column(
        "notification_outbound_jobs",
        sa.Column("routing_reason", sa.String(length=80), nullable=True),
    )

    op.add_column(
        "notifications",
        sa.Column("delivery_intent", sa.String(length=40), nullable=True),
    )

    op.add_column(
        "user_notification_preferences",
        sa.Column("personal_channel_mode", sa.String(length=30), nullable=False, server_default="both"),
    )


def downgrade() -> None:
    op.drop_column("user_notification_preferences", "personal_channel_mode")
    op.drop_column("notifications", "delivery_intent")
    op.drop_column("notification_outbound_jobs", "routing_reason")
    op.drop_column("notification_outbound_jobs", "delivery_intent")
    op.drop_column("notification_outbound_jobs", "delivery_target_type")
