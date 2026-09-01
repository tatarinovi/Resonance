"""add epic integration sync snapshots and queue.

Revision ID: 0016_epic_sync
Revises: 0015_global_integrations
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_epic_sync"
down_revision = "0015_global_integrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("integration_connections", sa.Column("settings_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.add_column("epics", sa.Column("jira_jql", sa.Text(), nullable=True))
    op.add_column("epic_test_runs", sa.Column("testops_launch_id", sa.String(128), nullable=True))
    op.create_table("epic_sync_runs", sa.Column("id", sa.BigInteger(), primary_key=True), sa.Column("epic_id", sa.Integer(), sa.ForeignKey("epics.id", ondelete="CASCADE"), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("trigger", sa.String(20), nullable=False), sa.Column("requested_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("started_at", sa.DateTime()), sa.Column("finished_at", sa.DateTime()), sa.Column("lease_expires_at", sa.DateTime()), sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"), sa.Column("available_at", sa.DateTime(), nullable=False), sa.Column("safe_error", sa.Text()))
    op.create_index("ix_epic_sync_runs_active", "epic_sync_runs", ["epic_id"], unique=True, postgresql_where=sa.text("status IN ('pending', 'running')"), sqlite_where=sa.text("status IN ('pending', 'running')"))
    op.create_table("epic_sync_source_steps", sa.Column("id", sa.BigInteger(), primary_key=True), sa.Column("sync_run_id", sa.BigInteger(), sa.ForeignKey("epic_sync_runs.id", ondelete="CASCADE"), nullable=False), sa.Column("source", sa.String(20), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("retryable", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("safe_error", sa.Text()), sa.Column("started_at", sa.DateTime()), sa.Column("finished_at", sa.DateTime()), sa.Column("counters_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")), sa.UniqueConstraint("sync_run_id", "source", name="uq_epic_sync_step_source"))
    op.create_table("epic_jira_issue_snapshots", sa.Column("id", sa.BigInteger(), primary_key=True), sa.Column("epic_id", sa.Integer(), sa.ForeignKey("epics.id", ondelete="CASCADE"), nullable=False), sa.Column("jira_issue_key", sa.String(128), nullable=False), sa.Column("summary", sa.Text(), nullable=False), sa.Column("status", sa.String(255), nullable=False), sa.Column("priority", sa.String(255)), sa.Column("assignee_display_name", sa.String(255)), sa.Column("issue_type", sa.String(255)), sa.Column("browser_url", sa.String(2048), nullable=False), sa.Column("is_bug", sa.Boolean(), nullable=False), sa.Column("is_blocker", sa.Boolean(), nullable=False), sa.Column("is_critical", sa.Boolean(), nullable=False), sa.Column("generated_at", sa.DateTime(), nullable=False), sa.UniqueConstraint("epic_id", "jira_issue_key", name="uq_epic_jira_issue_key"))
    op.create_table("epic_testops_snapshots", sa.Column("test_run_id", sa.BigInteger(), sa.ForeignKey("epic_test_runs.id", ondelete="CASCADE"), primary_key=True), sa.Column("external_launch_id", sa.String(128), nullable=False), sa.Column("status", sa.String(64), nullable=False), sa.Column("total", sa.Integer(), nullable=False), sa.Column("passed", sa.Integer(), nullable=False), sa.Column("failed", sa.Integer(), nullable=False), sa.Column("broken", sa.Integer(), nullable=False), sa.Column("blocked", sa.Integer(), nullable=False), sa.Column("in_progress", sa.Integer(), nullable=False), sa.Column("synced_at", sa.DateTime(), nullable=False))
    op.create_table("epic_testops_problem_cases", sa.Column("id", sa.BigInteger(), primary_key=True), sa.Column("test_run_id", sa.BigInteger(), sa.ForeignKey("epic_test_runs.id", ondelete="CASCADE"), nullable=False), sa.Column("case_name", sa.Text(), nullable=False), sa.Column("status", sa.String(64), nullable=False), sa.Column("safe_comment", sa.Text()), sa.Column("external_url", sa.String(2048)), sa.Column("defect_key", sa.String(128)))


def downgrade() -> None:
    for name in ("epic_testops_problem_cases", "epic_testops_snapshots", "epic_jira_issue_snapshots", "epic_sync_source_steps", "epic_sync_runs"):
        op.drop_table(name)
    op.drop_column("epic_test_runs", "testops_launch_id")
    op.drop_column("epics", "jira_jql")
    op.drop_column("integration_connections", "settings_json")
