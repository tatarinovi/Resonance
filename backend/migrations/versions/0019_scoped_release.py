"""add scoped analytics snapshots and global release keys.

Revision ID: 0019_scoped_release
Revises: 0018_release_center
"""
from alembic import op
import sqlalchemy as sa


revision = "0019_scoped_release"
down_revision = "0018_release_center"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    releases = sa.table(
        "releases",
        sa.column("id", sa.Integer),
        sa.column("sequence_number", sa.Integer),
        sa.column("created_at", sa.DateTime),
    )
    rows = connection.execute(
        sa.select(releases.c.id).order_by(releases.c.created_at.asc(), releases.c.id.asc())
    ).all()
    # Negative values avoid collisions with the old project-local numbers while rows are renumbered.
    for position, row in enumerate(rows, start=1):
        connection.execute(releases.update().where(releases.c.id == row.id).values(sequence_number=-position))
    for position, row in enumerate(rows, start=1):
        connection.execute(releases.update().where(releases.c.id == row.id).values(sequence_number=position))

    with op.batch_alter_table("releases") as batch:
        batch.drop_constraint("uq_release_project_sequence", type_="unique")
        batch.create_unique_constraint("uq_release_sequence", ["sequence_number"])

    op.create_table(
        "release_sequence_counter",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("next_value", sa.Integer(), nullable=False),
    )
    connection.execute(
        sa.text("INSERT INTO release_sequence_counter (id, next_value) VALUES (1, :next_value)"),
        {"next_value": len(rows) + 1},
    )

    op.create_table(
        "scoped_analytics_snapshots",
        sa.Column("scope_hash", sa.String(64), primary_key=True),
        sa.Column("scope_type", sa.String(64), nullable=False),
        sa.Column("scope_json", sa.JSON(), nullable=False),
        sa.Column("data_json", sa.JSON(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("refresh_started_at", sa.DateTime(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_attempt_failed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error_message", sa.String(500), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_scoped_analytics_snapshots_scope_type", "scoped_analytics_snapshots", ["scope_type"])


def downgrade() -> None:
    op.drop_table("scoped_analytics_snapshots")
    op.drop_table("release_sequence_counter")
    with op.batch_alter_table("releases") as batch:
        batch.drop_constraint("uq_release_sequence", type_="unique")
        batch.create_unique_constraint("uq_release_project_sequence", ["project_id", "sequence_number"])
