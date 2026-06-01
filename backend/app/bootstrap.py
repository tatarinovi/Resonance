"""Database bootstrap.

Runs Alembic migrations to bring the schema up to head, then performs idempotent
seeding (default admin, default settings, and one-shot legacy data migrations).
"""
from __future__ import annotations

import logging
import os

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, engine
from .models import (
    AppSetting,
    Epic,
    EpicAuditLog,
    EpicComment,
    EpicQA,
    EpicQAStatus,
    EpicStatus,
    EpicTestStage,
    Project,
    Ticket,
    User,
    UserRole,
)
from .security import hash_password


logger = logging.getLogger(__name__)


def _alembic_config() -> Config:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg_path = os.path.join(here, "alembic.ini")
    cfg = Config(cfg_path)
    cfg.set_main_option("script_location", os.path.join(here, "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    return cfg


def _existing_pre_alembic_database(inspector) -> bool:
    """Detect a database that pre-dates the introduction of Alembic.

    Such a DB has the legacy `users` / `tickets` tables but no `alembic_version` table.
    """
    table_names = set(inspector.get_table_names())
    if "alembic_version" in table_names:
        return False
    return "users" in table_names or "tickets" in table_names


def bootstrap_database(*, run_migrations: bool = True) -> None:
    """Bring schema and seed data up to date.

    The Matrix/Telegram bot should pass ``run_migrations=False``. Production should run
    this from the one-shot migration container before starting API and worker services.
    """
    if not run_migrations:
        logger.info("Skipping DB migrations and seed (run_migrations=False)")
        return

    inspector = inspect(engine)
    cfg = _alembic_config()

    if _existing_pre_alembic_database(inspector):
        # Stamp baseline so existing schema is recognised; later migrations apply on top.
        logger.info("Pre-Alembic database detected; stamping baseline 0001_baseline")
        command.stamp(cfg, "0001_baseline")

    logger.info("Running Alembic upgrade head")
    command.upgrade(cfg, "head")
    logger.info("Alembic upgrade finished")

    # Final safety net: ensure ORM-only tables introduced after migrations exist.
    Base.metadata.create_all(bind=engine)

    settings = get_settings()
    with Session(engine) as db:
        _ensure_default_admin(db, settings.default_admin_username, settings.default_admin_password)
        _ensure_default_settings(db)
        _migrate_epics(db)
        _migrate_epic_qa_shape(db)
        _migrate_epic_notes_to_comments(db)


def _migrate_epics(db: Session) -> None:
    """Move epics from Project.config_json list to the dedicated 'epics' table."""
    projects = db.scalars(select(Project)).all()
    for project in projects:
        epics_data = (project.config_json or {}).get("epics", [])
        if not epics_data:
            continue

        for epic_item in epics_data:
            title = epic_item.get("name", "Untitled")
            existing = db.scalar(select(Epic).where(Epic.project_id == project.id, Epic.title == title))
            if existing:
                continue

            status_val = epic_item.get("status", "new")
            if status_val == "released":
                e_status = EpicStatus.RELEASED
            elif status_val == "in-progress":
                e_status = EpicStatus.IN_PROGRESS
            else:
                e_status = EpicStatus.NEW

            new_epic = Epic(
                project_id=project.id,
                title=title,
                status=e_status,
                jira_url=epic_item.get("url") or "https://jira.example.com",
                confluence_url=epic_item.get("url") or "https://confluence.example.com",
                lead_analyst_id=epic_item.get("lead_analyst_id"),
                lead_designer_id=epic_item.get("lead_designer_id"),
                expert_id=epic_item.get("expert_id"),
            )
            db.add(new_epic)
            db.flush()

            qa_status = (
                EpicQAStatus.CLOSED.value.upper()
                if e_status == EpicStatus.RELEASED
                else EpicQAStatus.DRAFT.value.upper()
            )
            db.add(
                EpicQA(
                    epic_id=new_epic.id,
                    status=qa_status,
                    active_test_stage=(
                        EpicTestStage.PROD.value
                        if qa_status == EpicQAStatus.CLOSED.value.upper()
                        else EpicTestStage.TEST.value
                    ),
                    test_plan_items=[],
                )
            )

            tickets_to_link = db.scalars(
                select(Ticket).where(
                    Ticket.project_id == project.id,
                    Ticket.data_json["epic_name"].as_string() == title,
                )
            ).all()
            for t in tickets_to_link:
                t.epic_id = new_epic.id

        from sqlalchemy.orm.attributes import flag_modified

        new_config = (project.config_json or {}).copy()
        if "epics" in new_config:
            del new_config["epics"]
            project.config_json = new_config
            flag_modified(project, "config_json")
        db.commit()


def _migrate_epic_qa_shape(db: Session) -> None:
    status_map = {
        "draft": EpicQAStatus.DRAFT.value.upper(),
        "in_review": EpicQAStatus.IN_TESTING.value.upper(),
        "changes_requested": EpicQAStatus.BLOCKED.value.upper(),
        "approved": EpicQAStatus.PROD_COMPLETE.value.upper(),
    }

    qas = db.scalars(select(EpicQA)).all()
    changed = False
    for qa in qas:
        raw_status = str(qa.status or EpicQAStatus.DRAFT.value.upper()).strip()
        mapped_status = status_map.get(raw_status.lower(), raw_status.upper())
        if qa.status != mapped_status:
            qa.status = mapped_status
            changed = True

        if not qa.active_test_stage:
            status_key = str(qa.status or "").strip().lower()
            if status_key == EpicQAStatus.STAGE_COMPLETE.value:
                qa.active_test_stage = EpicTestStage.STAGE.value
            elif status_key in {EpicQAStatus.PROD_COMPLETE.value, EpicQAStatus.CLOSED.value}:
                qa.active_test_stage = EpicTestStage.PROD.value
            else:
                qa.active_test_stage = EpicTestStage.TEST.value
            changed = True

        items = qa.test_plan_items or []
        if not items and qa.legacy_test_plan:
            qa.test_plan_items = [
                {
                    "id": "legacy-plan",
                    "title": "Legacy test plan",
                    "description_markdown": qa.legacy_test_plan,
                    "is_checked": False,
                    "comment": "",
                }
            ]
            changed = True

        for item in qa.test_plan_items or []:
            item.setdefault("id", f"item-{abs(hash(item.get('title', 'plan')))}")
            item.setdefault("title", item.get("title") or "Untitled check")
            item.setdefault(
                "description_markdown",
                item.get("description_markdown") or item.get("description") or "",
            )
            item.setdefault("is_checked", bool(item.get("is_checked")))
            item.setdefault("comment", item.get("comment") or "")

    if changed:
        db.commit()


def _migrate_epic_notes_to_comments(db: Session) -> None:
    epics = db.scalars(select(Epic)).all()
    changed = False
    for epic in epics:
        if not epic.notes or not epic.notes.strip():
            continue
        existing = db.scalar(select(EpicComment).where(EpicComment.epic_id == epic.id))
        if existing:
            continue
        db.add(EpicComment(epic_id=epic.id, user_id=None, body=epic.notes.strip()))
        changed = True
    if changed:
        db.commit()


def _ensure_default_admin(db: Session, username: str, password: str) -> None:
    existing_admin = db.scalar(select(User).where(User.role == UserRole.ADMIN))
    if existing_admin:
        return

    normalized_username = username.strip()
    if not normalized_username or not password:
        raise RuntimeError(
            "No admin user exists and bootstrap credentials are not configured. "
            "Set DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD before startup."
        )

    if normalized_username.lower() == "admin" and password == "admin":
        raise RuntimeError(
            "Refusing to bootstrap the default insecure admin/admin account. "
            "Override DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD before startup."
        )

    existing_user = db.scalar(select(User).where(User.username == normalized_username))
    if existing_user:
        raise RuntimeError(
            f"Cannot bootstrap admin user '{normalized_username}': username already exists with role "
            f"'{existing_user.role.value}'."
        )

    db.add(
        User(
            username=normalized_username,
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
        )
    )
    db.commit()


def _ensure_default_settings(db: Session) -> None:
    setting = db.get(AppSetting, "global_routing")
    if setting:
        return
    db.add(
        AppSetting(
            key="global_routing",
            value_json={"expert_room_ids": {}, "lead_matrix_ids": {}},
        )
    )
    db.commit()
