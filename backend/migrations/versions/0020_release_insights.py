"""Persist Jira category and TestOps result identity without invalidating caches."""
from alembic import op
import sqlalchemy as sa

revision = "0020_release_insights"
down_revision = "0019_scoped_release"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("epic_test_runs", sa.Column("sync_attempt_at", sa.DateTime(), nullable=True))
    op.add_column("epic_test_runs", sa.Column("sync_error", sa.String(500), nullable=True))
    op.add_column("epic_jira_issues", sa.Column("status_category", sa.String(64), nullable=True))
    op.add_column("epic_testops_problem_cases", sa.Column("external_result_id", sa.String(128), nullable=True))
    op.add_column("epic_testops_problem_cases", sa.Column("parameters", sa.JSON(), nullable=True))
    op.add_column("epic_testops_problem_cases", sa.Column("link_kind", sa.String(20), nullable=False, server_default="launch"))


def downgrade():
    with op.batch_alter_table("epic_test_runs") as batch:
        batch.drop_column("sync_attempt_at")
        batch.drop_column("sync_error")
    with op.batch_alter_table("epic_testops_problem_cases") as batch:
        for name in ("link_kind", "parameters", "external_result_id"):
            batch.drop_column(name)
    with op.batch_alter_table("epic_jira_issues") as batch:
        batch.drop_column("status_category")
