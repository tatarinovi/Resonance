from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Project, Ticket, TicketStatus, User, UserRole
from app.security import create_access_token, hash_password


def _client_with_db():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), TestingSessionLocal


def _auth(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(username)}"}


def _user(username: str, *, role: UserRole = UserRole.EMPLOYEE, approved: bool = True) -> User:
    return User(
        username=username,
        password_hash=hash_password("secret123"),
        role=role,
        is_approved=approved,
        direction="front",
    )


def test_public_profile_returns_only_allowlisted_fields():
    client, SessionLocal = _client_with_db()
    try:
        with SessionLocal() as db:
            project = Project(name="Project A")
            viewer = _user("viewer")
            owner = _user("owner")
            owner.telegram_id = "telegram-secret"
            owner.matrix_id = "@owner:matrix"
            owner.kanban_token = "kanban-secret"
            owner.projects = [project]
            db.add_all([project, viewer, owner])
            db.commit()
            owner_id = owner.id

        response = client.get(f"/api/users/{owner_id}/profile", headers=_auth("viewer"))

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {
            "id",
            "username",
            "role",
            "workspace",
            "telegram_id",
            "matrix_id",
            "direction",
            "project_ids",
            "created_at",
            "last_login_at",
        }
        forbidden = {
            "password_hash",
            "telegram_notifications",
            "matrix_dm_enabled",
            "matrix_dm_room_id",
            "kanban_token",
            "kanban_connected",
            "personal_channel_mode",
        }
        assert forbidden.isdisjoint(body)
        assert body["telegram_id"] == "telegram-secret"
        assert body["matrix_id"] == "@owner:matrix"
    finally:
        app.dependency_overrides.clear()


def test_unapproved_profile_is_404_for_regular_user():
    client, SessionLocal = _client_with_db()
    try:
        with SessionLocal() as db:
            viewer = _user("viewer")
            pending = _user("pending", approved=False)
            db.add_all([viewer, pending])
            db.commit()
            pending_id = pending.id

        response = client.get(f"/api/users/{pending_id}/profile", headers=_auth("viewer"))

        assert response.status_code == 404
        assert response.json() == {"detail": "User not found"}
    finally:
        app.dependency_overrides.clear()


def test_profile_stats_use_viewer_visibility_not_profile_owner_projects():
    client, SessionLocal = _client_with_db()
    try:
        with SessionLocal() as db:
            project_a = Project(name="Project A")
            project_b = Project(name="Project B")
            viewer = _user("viewer")
            owner = _user("owner")
            viewer.projects = [project_a]
            owner.projects = [project_b]
            db.add_all([project_a, project_b, viewer, owner])
            db.flush()
            hidden_ticket = Ticket(
                project_id=project_b.id,
                status=TicketStatus.CLOSED,
                origin_event_id="hidden-1",
                title="Hidden question",
                author_id=owner.id,
                created_at=datetime.utcnow(),
            )
            db.add(hidden_ticket)
            db.commit()
            owner_id = owner.id

        profile = client.get(f"/api/users/{owner_id}/profile", headers=_auth("viewer"))
        stats = client.get(f"/api/users/{owner_id}/profile/stats", headers=_auth("viewer"))

        assert profile.status_code == 200
        assert stats.status_code == 200
        assert stats.json()["authored_total"] == 0
        assert stats.json()["authored_closed"] == 0
        assert all(day["count"] == 0 for day in stats.json()["question_heatmap"])
    finally:
        app.dependency_overrides.clear()
