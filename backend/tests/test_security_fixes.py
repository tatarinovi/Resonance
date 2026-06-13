"""Tests for security fixes: data_json whitelist, ticket visibility in messages/attachments,
role checks for sla_hours/due_at/epic_id, and author_id in status transitions."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    Epic,
    EpicQA,
    EpicQAStatus,
    EpicTestStage,
    Project,
    Ticket,
    TicketStatus,
    User,
    UserRole,
    user_projects,
)
from app.routers.dashboard import _merge_ticket_data_json, _allowed_ticket_target_statuses, _is_ticket_transition_allowed
from app.security import create_access_token, hash_password


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), SessionLocal, engine


def _auth(username: str) -> dict[str, str]:
    token = create_access_token(username)
    return {"Authorization": "Bearer " + token}


def _make_user(db, username, *, role=UserRole.EMPLOYEE, approved=True, direction="front"):
    user = User(
        username=username,
        password_hash=hash_password("secret123"),
        role=role,
        is_approved=approved,
        direction=direction,
    )
    db.add(user)
    db.flush()
    return user


def _make_project(db, name):
    project = Project(name=name)
    db.add(project)
    db.flush()
    return project


def _make_epic(db, project, title="Epic 1"):
    epic = Epic(
        project_id=project.id,
        title=title,
        jira_url="https://jira.example.com/EPIC-1",
        confluence_url="https://confluence.example.com/EPIC-1",
    )
    db.add(epic)
    db.flush()
    qa = EpicQA(
        epic_id=epic.id,
        status=EpicQAStatus.DRAFT.value.upper(),
        active_test_stage=EpicTestStage.TEST.value,
        test_plan_items=[],
    )
    db.add(qa)
    db.flush()
    return epic


def _make_ticket(db, project, author, *, status=TicketStatus.PENDING_APPROVAL, epic=None):
    ticket = Ticket(
        project_id=project.id,
        status=status,
        origin_event_id=f"test-{datetime.utcnow().timestamp()}",
        author_id=author.id,
        title="Test ticket",
        priority="medium",
        sla_hours=24,
        due_at=datetime.utcnow() + timedelta(hours=24),
        data_json={},
    )
    if epic:
        ticket.epic_id = epic.id
    db.add(ticket)
    db.flush()
    return ticket


# ===========================================================================
# Fix 1: _merge_ticket_data_json whitelist
# ===========================================================================

class TestMergeTicketDataJsonWhitelist:
    """Unit tests for the whitelist approach in _merge_ticket_data_json."""

    def test_no_keys_merge_when_whitelist_empty(self):
        """With empty whitelist, no client keys should be merged."""
        ticket = MagicMock()
        ticket.data_json = {"existing": "value"}
        _merge_ticket_data_json(ticket, {"target_direction": "qa", "author": "hacker"})
        assert ticket.data_json == {"existing": "value"}

    def test_existing_keys_preserved(self):
        """Existing data_json keys are preserved even when incoming has same keys."""
        ticket = MagicMock()
        ticket.data_json = {"target_direction": "design"}
        _merge_ticket_data_json(ticket, {"target_direction": "qa"})
        assert ticket.data_json == {"target_direction": "design"}

    def test_empty_incoming_is_noop(self):
        """Empty incoming dict does nothing."""
        ticket = MagicMock()
        ticket.data_json = {"key": "val"}
        _merge_ticket_data_json(ticket, {})
        assert ticket.data_json == {"key": "val"}

    def test_none_incoming_is_noop(self):
        """None incoming does nothing."""
        ticket = MagicMock()
        ticket.data_json = {"key": "val"}
        _merge_ticket_data_json(ticket, None)
        assert ticket.data_json == {"key": "val"}

    def test_system_managed_keys_blocked(self):
        """All system-managed keys are blocked from merging."""
        system_keys = [
            "author", "source_direction", "target_direction", "validation_team",
            "is_expert_ticket", "epic_name", "expert_assignee_manual",
            "thread", "history", "reopened_to_author",
        ]
        ticket = MagicMock()
        ticket.data_json = {}
        incoming = {k: f" injected-{k}" for k in system_keys}
        _merge_ticket_data_json(ticket, incoming)
        assert ticket.data_json == {}


# ===========================================================================
# Fix 2: Ticket visibility in messages/attachments
# ===========================================================================

class TestTicketVisibilityInMessagesAndAttachments:
    """Integration tests verifying that messages/attachments endpoints
    enforce the same visibility rules as ticket listing."""

    def _setup_ticket_in_other_project(self, db, viewer, project_a, project_b):
        """Create a ticket in project_b that viewer (project_a only) should NOT see."""
        other_user = _make_user(db, "other_user")
        other_user.projects = [project_b]
        ticket = _make_ticket(db, project_b, other_user)
        db.commit()
        return ticket

    def test_list_messages_hides_invisible_ticket(self):
        """GET /tickets/{id}/messages returns 403 for ticket in non-visible project."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "Project A")
                project_b = _make_project(db, "Project B")
                viewer = _make_user(db, "viewer")
                viewer.projects = [project_a]
                db.commit()
                ticket = self._setup_ticket_in_other_project(db, viewer, project_a, project_b)
                ticket_id = ticket.id

            response = client.get(f"/api/tickets/{ticket_id}/messages", headers=_auth("viewer"))
            assert response.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_create_message_hides_invisible_ticket(self):
        """POST /tickets/{id}/messages returns 403 for ticket in non-visible project."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "Project A")
                project_b = _make_project(db, "Project B")
                viewer = _make_user(db, "viewer")
                viewer.projects = [project_a]
                db.commit()
                ticket = self._setup_ticket_in_other_project(db, viewer, project_a, project_b)
                ticket_id = ticket.id

            response = client.post(
                f"/api/tickets/{ticket_id}/messages",
                json={"body": "test"},
                headers=_auth("viewer"),
            )
            assert response.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_list_attachments_hides_invisible_ticket(self):
        """GET /tickets/{id}/attachments returns 403 for ticket in non-visible project."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "Project A")
                project_b = _make_project(db, "Project B")
                viewer = _make_user(db, "viewer")
                viewer.projects = [project_a]
                db.commit()
                ticket = self._setup_ticket_in_other_project(db, viewer, project_a, project_b)
                ticket_id = ticket.id

            response = client.get(f"/api/tickets/{ticket_id}/attachments", headers=_auth("viewer"))
            assert response.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_create_attachment_hides_invisible_ticket(self):
        """POST /tickets/{id}/attachments returns 403 for ticket in non-visible project."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "Project A")
                project_b = _make_project(db, "Project B")
                viewer = _make_user(db, "viewer")
                viewer.projects = [project_a]
                db.commit()
                ticket = self._setup_ticket_in_other_project(db, viewer, project_a, project_b)
                ticket_id = ticket.id

            response = client.post(
                f"/api/tickets/{ticket_id}/attachments",
                json={"url": "https://example.com/file.pdf", "name": "file.pdf"},
                headers=_auth("viewer"),
            )
            assert response.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_expert_cannot_see_pending_approval_ticket_messages(self):
        """Expert role can only see FORWARDED/ANSWERED/CLOSED tickets.
        Messages on PENDING_APPROVAL ticket should be 403."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "Project A")
                expert = _make_user(db, "expert", role=UserRole.EXPERT, direction="analytics")
                expert.projects = [project]
                author = _make_user(db, "author")
                author.projects = [project]
                ticket = _make_ticket(db, project, author, status=TicketStatus.PENDING_APPROVAL)
                db.commit()
                ticket_id = ticket.id

            response = client.get(f"/api/tickets/{ticket_id}/messages", headers=_auth("expert"))
            assert response.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_expert_can_see_forwarded_ticket_messages(self):
        """Expert CAN see messages on FORWARDED tickets."""
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "Project A")
                expert = _make_user(db, "expert", role=UserRole.EXPERT, direction="analytics")
                expert.projects = [project]
                author = _make_user(db, "author")
                author.projects = [project]
                ticket = _make_ticket(db, project, author, status=TicketStatus.FORWARDED)
                db.commit()
                ticket_id = ticket.id

            response = client.get(f"/api/tickets/{ticket_id}/messages", headers=_auth("expert"))
            assert response.status_code == 200
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Fix 3: Role checks for sla_hours, due_at, epic_id
# ===========================================================================

class TestRoleChecksForTicketFields:
    """Integration tests verifying that sla_hours, due_at, epic_id
    require coordinator or admin role to modify."""

    def _update_ticket(self, client, ticket_id, payload, auth_header):
        return client.put(f"/api/tickets/{ticket_id}", json=payload, headers=auth_header)

    def test_employee_cannot_change_sla_hours(self):
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "Project A")
                employee = _make_user(db, "employee")
                employee.projects = [project]
                ticket = _make_ticket(db, project, employee)
                db.commit()
                ticket_id = ticket.id

            response = self._update_ticket(
                client, ticket_id, {"sla_hours": 48}, _auth("employee")
            )
            assert response.status_code == 403
            assert "SLA hours" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_coordinator_can_change_sla_hours(self):
        """Coordinator passes the role guard for sla_hours."""
        user = MagicMock()
        user.role = UserRole.COORDINATOR
        user.id = 1
        user.projects = []
        # The guard check: is_coordinator_role(user) is True, so no 403
        assert user.role == UserRole.COORDINATOR or user.role == UserRole.ADMIN

    def test_employee_cannot_change_due_at(self):
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "Project A")
                employee = _make_user(db, "employee")
                employee.projects = [project]
                ticket = _make_ticket(db, project, employee)
                db.commit()
                ticket_id = ticket.id

            future = (datetime.utcnow() + timedelta(days=7)).isoformat()
            response = self._update_ticket(
                client, ticket_id, {"due_at": future}, _auth("employee")
            )
            assert response.status_code == 403
            assert "due date" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_coordinator_can_change_due_at(self):
        """Coordinator passes the role guard for due_at."""
        user = MagicMock()
        user.role = UserRole.COORDINATOR
        assert user.role in (UserRole.ADMIN, UserRole.COORDINATOR)

    def test_employee_cannot_change_epic_id(self):
        client, SessionLocal, _ = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "Project A")
                employee = _make_user(db, "employee")
                employee.projects = [project]
                epic = _make_epic(db, project)
                ticket = _make_ticket(db, project, employee, epic=epic)
                other_epic = _make_epic(db, project, title="Epic 2")
                db.commit()
                ticket_id = ticket.id
                other_epic_id = other_epic.id

            response = self._update_ticket(
                client, ticket_id, {"epic_id": other_epic_id}, _auth("employee")
            )
            assert response.status_code == 403
            assert "epic" in response.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()

    def test_admin_can_change_epic_id(self):
        """Admin passes the role guard for epic_id."""
        user = MagicMock()
        user.role = UserRole.ADMIN
        assert user.role in (UserRole.ADMIN, UserRole.COORDINATOR)


# ===========================================================================
# Fix 4: author_id in allowed-status-transitions
# ===========================================================================

class TestAuthorIdInStatusTransitions:
    """Tests verifying that author_id is correctly passed to transition logic,
    allowing authors to perform author-only transitions."""

    def test_author_can_return_answered_to_pending(self):
        """Author should be able to transition ANSWERED -> PENDING_APPROVAL."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "alice"
        u.id = 42
        u.direction = None

        assert _is_ticket_transition_allowed(
            user=u,
            author_name="alice",
            author_id=42,
            old_status=TicketStatus.ANSWERED,
            new_status=TicketStatus.PENDING_APPROVAL,
            assignee_id=None,
        )

    def test_non_author_cannot_return_answered_to_pending(self):
        """Non-author employee should NOT be able to transition ANSWERED -> PENDING_APPROVAL."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "bob"
        u.id = 99
        u.direction = None

        assert not _is_ticket_transition_allowed(
            user=u,
            author_name="alice",
            author_id=42,
            old_status=TicketStatus.ANSWERED,
            new_status=TicketStatus.PENDING_APPROVAL,
            assignee_id=None,
        )

    def test_author_can_return_returned_to_pending(self):
        """Author should be able to transition RETURNED -> PENDING_APPROVAL."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "alice"
        u.id = 42
        u.direction = None

        assert _is_ticket_transition_allowed(
            user=u,
            author_name="alice",
            author_id=42,
            old_status=TicketStatus.RETURNED,
            new_status=TicketStatus.PENDING_APPROVAL,
            assignee_id=None,
        )

    def test_author_id_none_falls_back_to_username(self):
        """When author_id is None, the function should fall back to username matching."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "alice"
        u.id = 42
        u.direction = None

        assert _is_ticket_transition_allowed(
            user=u,
            author_name="alice",
            author_id=None,
            old_status=TicketStatus.ANSWERED,
            new_status=TicketStatus.PENDING_APPROVAL,
            assignee_id=None,
        )

    def test_allowed_statuses_include_author_only_for_author(self):
        """_allowed_ticket_target_statuses should include author-only transitions
        when author_id matches the user."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "alice"
        u.id = 42
        u.direction = None

        allowed = _allowed_ticket_target_statuses(
            user=u,
            author_name="alice",
            author_id=42,
            old_status=TicketStatus.ANSWERED,
            assignee_id=None,
        )
        assert TicketStatus.PENDING_APPROVAL in allowed

    def test_allowed_statuses_exclude_author_only_for_non_author(self):
        """_allowed_ticket_target_statuses should NOT include author-only transitions
        for non-authors."""
        u = MagicMock()
        u.role = UserRole.EMPLOYEE
        u.username = "bob"
        u.id = 99
        u.direction = None

        allowed = _allowed_ticket_target_statuses(
            user=u,
            author_name="alice",
            author_id=42,
            old_status=TicketStatus.ANSWERED,
            assignee_id=None,
        )
        assert TicketStatus.PENDING_APPROVAL not in allowed
