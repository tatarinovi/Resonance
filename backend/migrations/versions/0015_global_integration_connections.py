"""create globally configured external integration connections.

Revision ID: 0015_global_integrations
Revises: 0014_userrole_coordinator
"""

from __future__ import annotations

from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0015_global_integrations"
down_revision: Union[str, None] = "0014_userrole_coordinator"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "integration_connections",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("integration_type", sa.String(length=20), nullable=False),
        sa.Column("endpoint", sa.String(length=1000), nullable=False, server_default=""),
        sa.Column("auth_type", sa.String(length=20), nullable=False, server_default="token"),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("encrypted_secret", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("last_check_status", sa.String(length=32), nullable=False, server_default="never"),
        sa.Column("last_check_error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "integration_type IN ('kanban', 'jira', 'testops')",
            name="ck_integration_connections_type",
        ),
        sa.UniqueConstraint("integration_type", name="uq_integration_connections_type"),
    )
    now = datetime.utcnow()
    table = sa.table(
        "integration_connections",
        sa.column("integration_type", sa.String),
        sa.column("endpoint", sa.String),
        sa.column("auth_type", sa.String),
        sa.column("last_check_status", sa.String),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    op.bulk_insert(
        table,
        [
            {"integration_type": "kanban", "endpoint": "", "auth_type": "token", "last_check_status": "never", "created_at": now, "updated_at": now},
            {"integration_type": "jira", "endpoint": "", "auth_type": "token", "last_check_status": "never", "created_at": now, "updated_at": now},
            {"integration_type": "testops", "endpoint": "", "auth_type": "token", "last_check_status": "never", "created_at": now, "updated_at": now},
        ],
    )


def downgrade() -> None:
    op.drop_table("integration_connections")
