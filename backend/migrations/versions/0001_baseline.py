"""baseline

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-09

This baseline is idempotent: it uses CREATE TABLE IF NOT EXISTS so it can be
applied to a brand-new database (where it creates the schema as it existed in
the pre-Alembic era) or stamped onto an existing production database.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATE_STATEMENTS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(120) NOT NULL UNIQUE,
        password_hash VARCHAR(512) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
        telegram_id VARCHAR(120),
        telegram_notifications BOOLEAN NOT NULL DEFAULT TRUE,
        is_approved BOOLEAN NOT NULL DEFAULT TRUE,
        matrix_id VARCHAR(120),
        matrix_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        matrix_dm_room_id VARCHAR(255),
        kanban_token VARCHAR(512),
        workspace VARCHAR(20) NOT NULL DEFAULT 'ds',
        direction VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_users_username ON users(username);",
    """
    CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        config_json JSON NOT NULL DEFAULT '{}'::json,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS user_projects (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, project_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS epics (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'NEW',
        jira_url VARCHAR(512) NOT NULL,
        confluence_url VARCHAR(512) NOT NULL,
        kanban_url VARCHAR(512),
        design_url VARCHAR(512),
        notes TEXT,
        qa_estimate_hours DOUBLE PRECISION,
        qa_member_ids JSON NOT NULL DEFAULT '[]'::json,
        spent_total_hours DOUBLE PRECISION,
        spent_qa_hours DOUBLE PRECISION,
        spent_synced_at TIMESTAMP,
        spent_sync_error TEXT,
        lead_analyst_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        lead_designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expert_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_epics_project_id ON epics(project_id);",
    """
    CREATE TABLE IF NOT EXISTS epic_qa (
        id SERIAL PRIMARY KEY,
        epic_id INTEGER NOT NULL UNIQUE REFERENCES epics(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
        active_test_stage VARCHAR(20) NOT NULL DEFAULT 'test',
        test_plan TEXT,
        test_ops_url VARCHAR(512),
        test_runs_pending BOOLEAN NOT NULL DEFAULT FALSE,
        platform_coverage JSON NOT NULL DEFAULT '{}'::json,
        test_plan_items JSON NOT NULL DEFAULT '[]'::json,
        test_run_test_url VARCHAR(512),
        test_run_stage_url VARCHAR(512),
        test_run_prod_url VARCHAR(512),
        risks TEXT,
        blockers TEXT,
        known_limitations TEXT,
        verdict TEXT,
        reviewer_comments TEXT,
        created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS epic_audit_logs (
        id SERIAL PRIMARY KEY,
        epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        old_status VARCHAR(50),
        new_status VARCHAR(50),
        comment TEXT,
        details_json JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_epic_audit_logs_epic_id ON epic_audit_logs(epic_id);",
    "CREATE INDEX IF NOT EXISTS ix_epic_audit_logs_user_id ON epic_audit_logs(user_id);",
    """
    CREATE TABLE IF NOT EXISTS epic_comments (
        id SERIAL PRIMARY KEY,
        epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_epic_comments_epic_id ON epic_comments(epic_id);",
    """
    CREATE TABLE IF NOT EXISTS kanban_epic_comments (
        id SERIAL PRIMARY KEY,
        project_slug VARCHAR(120) NOT NULL,
        kanban_epic_id INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_kanban_epic_comments_project_slug ON kanban_epic_comments(project_slug);",
    "CREATE INDEX IF NOT EXISTS ix_kanban_epic_comments_kanban_epic_id ON kanban_epic_comments(kanban_epic_id);",
    """
    CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING_APPROVAL',
        origin_event_id VARCHAR(255) NOT NULL,
        expert_event_id VARCHAR(255),
        data_json JSON NOT NULL DEFAULT '{}'::json,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tickets_origin_event_id UNIQUE (origin_event_id),
        CONSTRAINT uq_tickets_expert_event_id UNIQUE (expert_event_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_tickets_project_id ON tickets(project_id);",
    "CREATE INDEX IF NOT EXISTS ix_tickets_epic_id ON tickets(epic_id);",
    "CREATE INDEX IF NOT EXISTS ix_tickets_origin_event_id ON tickets(origin_event_id);",
    "CREATE INDEX IF NOT EXISTS ix_tickets_expert_event_id ON tickets(expert_event_id);",
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(80) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        target_type VARCHAR(50) NOT NULL,
        target_id INTEGER NOT NULL,
        target_url VARCHAR(512) NOT NULL,
        dedupe_key VARCHAR(255) NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_notifications_recipient_dedupe_key UNIQUE (recipient_id, dedupe_key)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_notifications_recipient_id ON notifications(recipient_id);",
    "CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications(type);",
    "CREATE INDEX IF NOT EXISTS ix_notifications_is_read ON notifications(is_read);",
    """
    CREATE TABLE IF NOT EXISTS feedback_requests (
        id SERIAL PRIMARY KEY,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_username VARCHAR(120) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'IMPROVEMENT',
        status VARCHAR(50) NOT NULL DEFAULT 'NEW',
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        context_url VARCHAR(512),
        expected_result TEXT,
        steps_to_reproduce TEXT,
        admin_response TEXT,
        responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        responder_username VARCHAR(120),
        responded_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_feedback_requests_author_id ON feedback_requests(author_id);",
    "CREATE INDEX IF NOT EXISTS ix_feedback_requests_status ON feedback_requests(status);",
    "CREATE INDEX IF NOT EXISTS ix_feedback_requests_responder_id ON feedback_requests(responder_id);",
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(120) PRIMARY KEY,
        value_json JSON NOT NULL DEFAULT '{}'::json,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS telegram_linking_tokens (
        token VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_telegram_linking_tokens_user_id ON telegram_linking_tokens(user_id);",
]


def upgrade() -> None:
    for stmt in CREATE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    pass
