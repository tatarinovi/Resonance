"""ensure coordinator role enum value.

Revision ID: 0014_userrole_coordinator
Revises: 0013_kanban_legacy_task_seen
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0014_userrole_coordinator"
down_revision: Union[str, None] = "0013_kanban_legacy_task_seen"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'userrole') THEN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'userrole' AND e.enumlabel = 'COORDINATOR'
                ) THEN
                    ALTER TYPE userrole ADD VALUE 'COORDINATOR';
                END IF;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values safely without rebuilding the type.
    pass
