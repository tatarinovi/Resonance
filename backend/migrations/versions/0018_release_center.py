"""add release center and Epic-owned external sync caches.

Revision ID: 0018_release_center
Revises: 0017_simplify_epic
"""
from alembic import op
import sqlalchemy as sa


revision = "0018_release_center"
down_revision = "0017_simplify_epic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("epic_test_runs", sa.Column("testops_launch_id", sa.String(128), nullable=True))
    op.create_index("ix_epic_test_runs_testops_launch_id", "epic_test_runs", ["testops_launch_id"])

    op.create_table(
        "epic_external_sync_states",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("epic_id", sa.Integer(), sa.ForeignKey("epics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("last_error_message", sa.String(500), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("epic_id", "source", name="uq_epic_external_sync_source"),
        sa.CheckConstraint("source IN ('jira', 'testops')", name="ck_epic_external_sync_source"),
    )
    op.create_index("ix_epic_external_sync_states_epic_id", "epic_external_sync_states", ["epic_id"])

    op.create_table(
        "epic_testops_snapshots",
        sa.Column("test_run_id", sa.BigInteger(), sa.ForeignKey("epic_test_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("external_launch_id", sa.String(128), nullable=False),
        sa.Column("status", sa.String(64), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("broken", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("in_progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "epic_testops_problem_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("test_run_id", sa.BigInteger(), sa.ForeignKey("epic_testops_snapshots.test_run_id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_name", sa.Text(), nullable=False),
        sa.Column("status", sa.String(64), nullable=False),
        sa.Column("safe_comment", sa.Text(), nullable=True),
        sa.Column("external_url", sa.String(2048), nullable=True),
        sa.Column("defect_key", sa.String(128), nullable=True),
    )
    op.create_index("ix_epic_testops_problem_cases_test_run_id", "epic_testops_problem_cases", ["test_run_id"])

    op.create_table(
        "releases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("planned_release_at", sa.DateTime(), nullable=True),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("release_note", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("archived_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "sequence_number", name="uq_release_project_sequence"),
        sa.CheckConstraint("status IN ('DRAFT','IN_PROGRESS','READY','RELEASED','CANCELLED')", name="ck_release_status"),
    )
    for name, columns in (
        ("ix_releases_project_id", ["project_id"]),
        ("ix_releases_status", ["status"]),
        ("ix_releases_planned_release_at", ["planned_release_at"]),
        ("ix_releases_owner_user_id", ["owner_user_id"]),
        ("ix_releases_archived_at", ["archived_at"]),
    ):
        op.create_index(name, "releases", columns)

    op.create_table(
        "release_epic_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("release_id", sa.Integer(), sa.ForeignKey("releases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("epic_id", sa.Integer(), sa.ForeignKey("epics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("removed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_release_epic_memberships_release_id", "release_epic_memberships", ["release_id"])
    op.create_index("ix_release_epic_memberships_epic_id", "release_epic_memberships", ["epic_id"])
    op.create_index(
        "uq_release_membership_active_epic",
        "release_epic_memberships",
        ["epic_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        sqlite_where=sa.text("is_active = 1"),
    )

    op.create_table(
        "release_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("release_id", sa.Integer(), sa.ForeignKey("releases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("details_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_release_audit_logs_release_id", "release_audit_logs", ["release_id"])
    op.create_index("ix_release_audit_logs_actor_user_id", "release_audit_logs", ["actor_user_id"])


def downgrade() -> None:
    op.drop_table("release_audit_logs")
    op.drop_index("uq_release_membership_active_epic", table_name="release_epic_memberships")
    op.drop_table("release_epic_memberships")
    op.drop_table("releases")
    op.drop_table("epic_testops_problem_cases")
    op.drop_table("epic_testops_snapshots")
    op.drop_table("epic_external_sync_states")
    op.drop_index("ix_epic_test_runs_testops_launch_id", table_name="epic_test_runs")
    op.drop_column("epic_test_runs", "testops_launch_id")
