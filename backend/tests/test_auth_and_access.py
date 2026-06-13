"""Critical auth endpoint tests: login, register, JWT, unapproved rejection."""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import User, UserRole
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


def _make_user(db, username, *, role=UserRole.EMPLOYEE, approved=True):
    user = User(
        username=username,
        password_hash=hash_password("secret123"),
        role=role,
        is_approved=approved,
    )
    db.add(user)
    db.flush()
    return user


# ===========================================================================
# Login
# ===========================================================================

class TestLogin:
    def test_login_success(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "alice")
                db.commit()

            resp = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
            assert resp.status_code == 200
            assert "access_token" in resp.json()
        finally:
            app.dependency_overrides.clear()

    def test_login_wrong_password(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "alice")
                db.commit()

            resp = client.post("/api/auth/login", json={"username": "alice", "password": "wrong"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    def test_login_nonexistent_user(self):
        client, _ = _setup()
        try:
            resp = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    def test_login_unapproved_user(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "pending", approved=False)
                db.commit()

            resp = client.post("/api/auth/login", json={"username": "pending", "password": "secret123"})
            assert resp.status_code == 403
            assert "approval" in resp.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Register
# ===========================================================================

class TestRegister:
    def test_register_success(self):
        client, _ = _setup()
        try:
            resp = client.post("/api/auth/register", json={
                "username": "newuser",
                "password": "pass123456",
                "workspace": "ds",
                "direction": "front",
            })
            assert resp.status_code == 201
            assert "message" in resp.json()
        finally:
            app.dependency_overrides.clear()

    def test_register_duplicate_username(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "existing")
                db.commit()

            resp = client.post("/api/auth/register", json={
                "username": "existing",
                "password": "pass123456",
                "workspace": "ds",
                "direction": "front",
            })
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    def test_register_short_username(self):
        client, _ = _setup()
        try:
            resp = client.post("/api/auth/register", json={
                "username": "ab",
                "password": "pass123456",
                "workspace": "ds",
                "direction": "front",
            })
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    def test_register_short_password(self):
        client, _ = _setup()
        try:
            resp = client.post("/api/auth/register", json={
                "username": "newuser",
                "password": "12345",
                "workspace": "ds",
                "direction": "front",
            })
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    def test_register_creates_unapproved_user(self):
        client, SessionLocal = _setup()
        try:
            client.post("/api/auth/register", json={
                "username": "newuser",
                "password": "pass123456",
                "workspace": "ds",
                "direction": "front",
            })

            with SessionLocal() as db:
                from sqlalchemy import select
                user = db.scalar(select(User).where(User.username == "newuser"))
                assert user is not None
                assert user.is_approved is False
                assert user.role == UserRole.EMPLOYEE
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# JWT / /me
# ===========================================================================

class TestMeEndpoint:
    def test_me_returns_user_info(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "alice", role=UserRole.COORDINATOR)
                db.commit()

            resp = client.get("/api/auth/me", headers=_auth("alice"))
            assert resp.status_code == 200
            body = resp.json()
            assert body["username"] == "alice"
            assert body["role"] == "coordinator"
        finally:
            app.dependency_overrides.clear()

    def test_me_without_token(self):
        client, _ = _setup()
        try:
            resp = client.get("/api/auth/me")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    def test_me_with_invalid_token(self):
        client, _ = _setup()
        try:
            resp = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    def test_me_unapproved_user_rejected(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "pending", approved=False)
                db.commit()

            resp = client.get("/api/auth/me", headers=_auth("pending"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Admin-only access enforcement
# ===========================================================================

class TestAdminOnlyAccess:
    def test_employee_cannot_list_users(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "emp")
                db.commit()

            resp = client.get("/api/admin/users", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_coordinator_cannot_list_users(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "coord", role=UserRole.COORDINATOR)
                db.commit()

            resp = client.get("/api/admin/users", headers=_auth("coord"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_admin_can_list_users(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "admin", role=UserRole.ADMIN)
                db.commit()

            resp = client.get("/api/admin/users", headers=_auth("admin"))
            assert resp.status_code == 200
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_delete_epic(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                from app.models import Epic, Project, EpicQA, EpicQAStatus, EpicTestStage
                project = Project(name="P1")
                emp = _make_user(db, "emp")
                emp.projects = [project]
                db.add(project)
                db.flush()
                epic = Epic(
                    project_id=project.id, title="E1",
                    jira_url="https://j.example.com/1",
                    confluence_url="https://c.example.com/1",
                )
                db.add(epic)
                db.flush()
                db.add(EpicQA(
                    epic_id=epic.id,
                    status=EpicQAStatus.DRAFT.value.upper(),
                    active_test_stage=EpicTestStage.TEST.value,
                    test_plan_items=[],
                ))
                db.commit()
                epic_id = epic.id

            resp = client.delete(f"/api/epics/{epic_id}", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_manage_kanban(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "emp")
                db.commit()

            resp = client.get("/api/kanban/projects", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_update_global_routing(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "emp")
                db.commit()

            resp = client.put(
                "/api/admin/settings/global-routing",
                json={"expert_room_ids": {}, "lead_matrix_ids": {}},
                headers=_auth("emp"),
            )
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_cleanup_files(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "emp")
                db.commit()

            resp = client.delete("/api/files/cleanup", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()
