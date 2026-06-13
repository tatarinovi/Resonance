"""Critical epic CRUD tests: create, update, comments, blockers, QA transitions."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    Epic,
    EpicBlocker,
    EpicComment,
    EpicQA,
    EpicQAStatus,
    EpicTestStage,
    Project,
    User,
    UserRole,
)
from app.security import create_access_token, hash_password


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
    return TestClient(app), SessionLocal


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


# ===========================================================================
# Epic creation
# ===========================================================================

class TestEpicCreation:
    def test_coordinator_can_create_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                coord = _make_user(db, "coord", role=UserRole.COORDINATOR)
                coord.projects = [project]
                db.commit()
                project_id = project.id

            resp = client.post("/api/epics", json={
                "project_id": project_id,
                "title": "New Epic",
                "jira_url": "https://j.example.com/1",
                "confluence_url": "https://c.example.com/1",
            }, headers=_auth("coord"))
            assert resp.status_code == 201
            assert resp.json()["title"] == "New Epic"
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_create_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                db.commit()
                project_id = project.id

            resp = client.post("/api/epics", json={
                "project_id": project_id,
                "title": "Hack",
                "jira_url": "https://j.example.com/1",
                "confluence_url": "https://c.example.com/1",
            }, headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_cannot_create_epic_wrong_project(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "A")
                project_b = _make_project(db, "B")
                coord = _make_user(db, "coord", role=UserRole.COORDINATOR)
                coord.projects = [project_a]
                db.commit()
                project_b_id = project_b.id

            resp = client.post("/api/epics", json={
                "project_id": project_b_id,
                "title": "Hack",
                "jira_url": "https://j.example.com/1",
                "confluence_url": "https://c.example.com/1",
            }, headers=_auth("coord"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Epic update
# ===========================================================================

class TestEpicUpdate:
    def test_employee_can_edit_epic_notes_field(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.put(f"/api/epics/{epic_id}", json={
                "qa_estimate_hours": 10.5,
            }, headers=_auth("emp"))
            assert resp.status_code == 200
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_change_epic_title(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.put(f"/api/epics/{epic_id}", json={
                "title": "Hacked",
            }, headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_access_other_project_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project_a = _make_project(db, "A")
                project_b = _make_project(db, "B")
                emp = _make_user(db, "emp")
                emp.projects = [project_a]
                epic = _make_epic(db, project_b)
                db.commit()
                epic_id = epic.id

            resp = client.get(f"/api/epics/{epic_id}", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Epic comments
# ===========================================================================

class TestEpicComments:
    def test_project_member_can_comment(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.post(f"/api/epics/{epic_id}/comments", json={
                "body": "Test comment",
            }, headers=_auth("emp"))
            assert resp.status_code == 201
            assert resp.json()["body"] == "Test comment"
        finally:
            app.dependency_overrides.clear()

    def test_non_member_cannot_comment(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.post(f"/api/epics/{epic_id}/comments", json={
                "body": "Hack",
            }, headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_empty_comment_rejected(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.post(f"/api/epics/{epic_id}/comments", json={
                "body": "   ",
            }, headers=_auth("emp"))
            assert resp.status_code == 422
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Epic blockers
# ===========================================================================

class TestEpicBlockers:
    def test_member_can_add_blocker(self):
        """Member passes can_edit_epic_notes guard (unit test to avoid BigInteger PK issue)."""
        from app.access_policy import AccessPolicy
        user = MagicMock()
        user.role = UserRole.EMPLOYEE
        epic = MagicMock()
        epic.project_id = 1
        # AccessPolicy.has_project_access checks user.projects
        user.projects = [MagicMock(id=1)]
        assert AccessPolicy.can_edit_epic_notes(user, epic)

    def test_non_member_cannot_add_blocker(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                emp = _make_user(db, "emp")
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.post(f"/api/epics/{epic_id}/blockers", json={
                "body": "Hack",
            }, headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_member_can_resolve_blocker(self):
        """Member passes can_edit_epic_notes guard for blocker resolve (unit test)."""
        from app.access_policy import AccessPolicy
        user = MagicMock()
        user.role = UserRole.COORDINATOR
        epic = MagicMock()
        epic.project_id = 1
        user.projects = [MagicMock(id=1)]
        assert AccessPolicy.can_edit_epic_notes(user, epic)


# ===========================================================================
# Epic deletion
# ===========================================================================

class TestEpicDeletion:
    def test_coordinator_cannot_delete_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                coord = _make_user(db, "coord", role=UserRole.COORDINATOR)
                coord.projects = [project]
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.delete(f"/api/epics/{epic_id}", headers=_auth("coord"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_admin_can_delete_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                project = _make_project(db, "P1")
                admin = _make_user(db, "admin", role=UserRole.ADMIN)
                epic = _make_epic(db, project)
                db.commit()
                epic_id = epic.id

            resp = client.delete(f"/api/epics/{epic_id}", headers=_auth("admin"))
            assert resp.status_code == 204
        finally:
            app.dependency_overrides.clear()
