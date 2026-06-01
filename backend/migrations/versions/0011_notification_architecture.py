"""notification_architecture — correlation, domain event log, outbound queue, policies.

Revision ID: 0011_notification_architecture
Revises: 0010_ticket_subscribers
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "0011_notification_architecture"
down_revision: Union[str, None] = "0010_ticket_subscribers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "operation_contexts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("correlation_id", sa.String(length=80), nullable=False),
        sa.Column("command_type", sa.String(length=120), nullable=False, server_default="unknown"),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("http_request_id", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("correlation_id", name="uq_operation_contexts_correlation_id"),
    )
    op.create_index("ix_operation_contexts_actor_id", "operation_contexts", ["actor_id"])

    op.create_table(
        "domain_event_logs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("correlation_id", sa.String(length=80), nullable=False),
        sa.Column("causation_event_id", sa.String(length=40), nullable=True),
        sa.Column("operation_context_id", sa.Integer(), sa.ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("taxonomy_class", sa.String(length=40), nullable=False),
        sa.Column("notification_relevance", sa.String(length=40), nullable=False),
        sa.Column("primary_classification", sa.String(length=20), nullable=False, server_default="primary"),
        sa.Column("aggregate_type", sa.String(length=40), nullable=True),
        sa.Column("aggregate_id", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_domain_event_logs_event_id"),
    )
    op.create_index("ix_domain_event_logs_correlation_id", "domain_event_logs", ["correlation_id"])
    op.create_index(
        "ix_domain_event_logs_aggregate",
        "domain_event_logs",
        ["aggregate_type", "aggregate_id", "occurred_at"],
    )

    op.create_table(
        "notification_fanout_pending",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_key", sa.String(length=255), nullable=False),
        sa.Column("correlation_id", sa.String(length=80), nullable=False),
        sa.Column("payload_stub", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "recipient_id",
            "group_key",
            "correlation_id",
            name="uq_fanout_pending_recipient_group_corr",
        ),
    )

    op.create_table(
        "project_notification_policies",
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("realtime_matrix_room_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("digest_matrix_room_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("realtime_dm_default_for_roles", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("room_delivery_mode", sa.String(length=40), nullable=False, server_default="realtime_and_digest"),
        sa.Column("matrix_project_room_id", sa.String(length=255), nullable=True),
        sa.Column("quiet_hours_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("escalation_reminder_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("escalation_lead_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("prefer_dm_over_room", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("matrix_room_encryption_blocked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("matrix_room_last_success_at", sa.DateTime(), nullable=True),
        sa.Column("matrix_bot_joined_room", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("project_id"),
    )

    op.create_table(
        "user_notification_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quiet_hours_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("project_channel_overrides_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "notification_outbound_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("notification_id", sa.Integer(), sa.ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True),
        sa.Column("recipient_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel", sa.String(length=40), nullable=False),
        sa.Column("destination_ref", sa.String(length=512), nullable=False),
        sa.Column("payload_html", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("correlation_id", sa.String(length=80), nullable=True),
        sa.Column("operation_context_id", sa.Integer(), sa.ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("idempotency_key", sa.String(length=80), nullable=False),
        sa.Column("suppressed_reason", sa.String(length=120), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_notification_outbound_jobs_idempotency"),
    )
    op.create_index(
        "ix_notification_outbound_jobs_status_next",
        "notification_outbound_jobs",
        ["status", "next_attempt_at"],
    )
    op.create_index("ix_notification_outbound_jobs_correlation_id", "notification_outbound_jobs", ["correlation_id"])

    op.create_table(
        "notification_delivery_attempts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("notification_outbound_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_delivery_attempts_job_id", "notification_delivery_attempts", ["job_id"])
    op.create_index("ix_notification_delivery_attempts_created_at", "notification_delivery_attempts", ["created_at"])

    op.create_table(
        "digest_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
        sa.Column("matrix_room_id", sa.String(length=255), nullable=True),
        sa.Column("matrix_event_id", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_digest_runs_project_kind_created", "digest_runs", ["project_id", "kind", "created_at"])

    op.add_column(
        "notifications",
        sa.Column("lifecycle_status", sa.String(length=40), nullable=False, server_default="unread"),
    )
    op.add_column("notifications", sa.Column("seen_at", sa.DateTime(), nullable=True))
    op.add_column("notifications", sa.Column("snooze_until", sa.DateTime(), nullable=True))
    op.add_column(
        "notifications",
        sa.Column("muted", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("notifications", sa.Column("acknowledged_at", sa.DateTime(), nullable=True))
    op.add_column(
        "notifications",
        sa.Column("escalation_parent_id", sa.Integer(), sa.ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("notifications", sa.Column("escalation_round", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("notifications", sa.Column("last_escalation_at", sa.DateTime(), nullable=True))
    op.add_column(
        "notifications",
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="normal"),
    )
    op.add_column(
        "notifications",
        sa.Column("urgency", sa.String(length=20), nullable=False, server_default="passive"),
    )
    op.add_column("notifications", sa.Column("correlation_id", sa.String(length=80), nullable=True))
    op.add_column("notifications", sa.Column("operation_context_id", sa.Integer(), sa.ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True))
    op.add_column("notifications", sa.Column("source_event_id", sa.String(length=40), nullable=True))
    op.add_column("notifications", sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True))
    op.add_column("notifications", sa.Column("group_key", sa.String(length=255), nullable=True))
    op.add_column(
        "notifications",
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=text("'{}'::json")),
    )
    op.create_index("ix_notifications_correlation_id", "notifications", ["correlation_id"])
    op.create_index("ix_notifications_project_id", "notifications", ["project_id"])
    op.create_index("ix_notifications_lifecycle_status", "notifications", ["lifecycle_status"])


def downgrade() -> None:
    op.drop_index("ix_notifications_lifecycle_status", table_name="notifications")
    op.drop_index("ix_notifications_project_id", table_name="notifications")
    op.drop_index("ix_notifications_correlation_id", table_name="notifications")
    op.drop_column("notifications", "metadata_json")
    op.drop_column("notifications", "group_key")
    op.drop_column("notifications", "project_id")
    op.drop_column("notifications", "source_event_id")
    op.drop_column("notifications", "operation_context_id")
    op.drop_column("notifications", "correlation_id")
    op.drop_column("notifications", "urgency")
    op.drop_column("notifications", "severity")
    op.drop_column("notifications", "last_escalation_at")
    op.drop_column("notifications", "escalation_round")
    op.drop_column("notifications", "escalation_parent_id")
    op.drop_column("notifications", "acknowledged_at")
    op.drop_column("notifications", "muted")
    op.drop_column("notifications", "snooze_until")
    op.drop_column("notifications", "seen_at")
    op.drop_column("notifications", "lifecycle_status")

    op.drop_index("ix_digest_runs_project_kind_created", table_name="digest_runs")
    op.drop_table("digest_runs")

    op.drop_index("ix_notification_delivery_attempts_created_at", table_name="notification_delivery_attempts")
    op.drop_index("ix_notification_delivery_attempts_job_id", table_name="notification_delivery_attempts")
    op.drop_table("notification_delivery_attempts")

    op.drop_index("ix_notification_outbound_jobs_correlation_id", table_name="notification_outbound_jobs")
    op.drop_index("ix_notification_outbound_jobs_status_next", table_name="notification_outbound_jobs")
    op.drop_table("notification_outbound_jobs")

    op.drop_table("user_notification_preferences")
    op.drop_table("project_notification_policies")

    op.drop_table("notification_fanout_pending")

    op.drop_index("ix_domain_event_logs_aggregate", table_name="domain_event_logs")
    op.drop_index("ix_domain_event_logs_correlation_id", table_name="domain_event_logs")
    op.drop_table("domain_event_logs")

    op.drop_index("ix_operation_contexts_actor_id", table_name="operation_contexts")
    op.drop_table("operation_contexts")
