"""Critical notification and feedback tests: own-scoping, auth, CRUD."""
from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    FeedbackRequest,
    FeedbackStatus,
    FeedbackType,
    Notification,
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
# Notifications: own-scoping
# ===========================================================================

class TestNotificationScoping:
    def test_user_sees_own_notifications(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                alice = _make_user(db, "alice")
                bob = _make_user(db, "bob")
                db.flush()
                n1 = Notification(
                    recipient_id=alice.id, type="ticket_created",
                    title="T1", body="", target_type="ticket",
                    target_id=1, target_url="/t/1", dedupe_key="k1",
                )
                n2 = Notification(
                    recipient_id=bob.id, type="ticket_created",
                    title="T2", body="", target_type="ticket",
                    target_id=2, target_url="/t/2", dedupe_key="k2",
                )
                db.add_all([n1, n2])
                db.commit()

            resp = client.get("/api/notifications", headers=_auth("alice"))
            assert resp.status_code == 200
            items = resp.json()["items"]
            assert len(items) == 1
            assert items[0]["title"] == "T1"
        finally:
            app.dependency_overrides.clear()

    def test_user_cannot_mark_others_notification(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                alice = _make_user(db, "alice")
                bob = _make_user(db, "bob")
                db.flush()
                n = Notification(
                    recipient_id=bob.id, type="ticket_created",
                    title="Bob's", body="", target_type="ticket",
                    target_id=1, target_url="/t/1", dedupe_key="k3",
                )
                db.add(n)
                db.commit()
                n_id = n.id

            resp = client.post(f"/api/notifications/{n_id}/read", headers=_auth("alice"))
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_read_all_only_affects_own(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                alice = _make_user(db, "alice")
                bob = _make_user(db, "bob")
                db.flush()
                n1 = Notification(
                    recipient_id=alice.id, type="ticket_created",
                    title="A1", body="", target_type="ticket",
                    target_id=1, target_url="/t/1", dedupe_key="k4",
                )
                n2 = Notification(
                    recipient_id=bob.id, type="ticket_created",
                    title="B1", body="", target_type="ticket",
                    target_id=2, target_url="/t/2", dedupe_key="k5",
                )
                db.add_all([n1, n2])
                db.commit()

            resp = client.post("/api/notifications/read-all", headers=_auth("alice"))
            assert resp.status_code == 200
            assert resp.json()["updated"] == 1

            with SessionLocal() as db:
                from sqlalchemy import select
                bob_n = db.scalar(select(Notification).where(Notification.recipient_id == bob.id))
                assert bob_n.is_read is False
        finally:
            app.dependency_overrides.clear()

    def test_acknowledge_notification(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                alice = _make_user(db, "alice")
                db.flush()
                n = Notification(
                    recipient_id=alice.id, type="ticket_created",
                    title="Ack", body="", target_type="ticket",
                    target_id=1, target_url="/t/1", dedupe_key="k6",
                )
                db.add(n)
                db.commit()
                n_id = n.id

            resp = client.post(f"/api/notifications/{n_id}/acknowledge", headers=_auth("alice"))
            assert resp.status_code == 200
            assert resp.json()["lifecycle_status"] == "acknowledged"
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Feedback
# ===========================================================================

class TestFeedback:
    def test_create_feedback(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "alice")
                db.commit()

            resp = client.post("/api/feedback", json={
                "type": "bug",
                "title": "Something broken",
                "description": "Details here",
            }, headers=_auth("alice"))
            assert resp.status_code == 201
            assert resp.json()["status"] == "new"
        finally:
            app.dependency_overrides.clear()

    def test_list_own_feedback(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                alice = _make_user(db, "alice")
                bob = _make_user(db, "bob")
                db.flush()
                db.add(FeedbackRequest(
                    author_id=alice.id, author_username="alice",
                    type=FeedbackType.BUG, status=FeedbackStatus.NEW,
                    title="A's bug", description="...",
                ))
                db.add(FeedbackRequest(
                    author_id=bob.id, author_username="bob",
                    type=FeedbackType.BUG, status=FeedbackStatus.NEW,
                    title="B's bug", description="...",
                ))
                db.commit()

            resp = client.get("/api/feedback/mine", headers=_auth("alice"))
            assert resp.status_code == 200
            items = resp.json()["items"]
            assert len(items) == 1
            assert items[0]["title"] == "A's bug"
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_see_admin_feedback_list(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "emp")
                db.commit()

            resp = client.get("/api/feedback/admin", headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()

    def test_admin_can_update_feedback(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                admin = _make_user(db, "admin", role=UserRole.ADMIN)
                alice = _make_user(db, "alice")
                db.flush()
                fb = FeedbackRequest(
                    author_id=alice.id, author_username="alice",
                    type=FeedbackType.BUG, status=FeedbackStatus.NEW,
                    title="Bug", description="...",
                )
                db.add(fb)
                db.commit()
                fb_id = fb.id

            resp = client.put(f"/api/feedback/admin/{fb_id}", json={
                "status": "in_review",
                "admin_response": "We are looking into it",
            }, headers=_auth("admin"))
            assert resp.status_code == 200
            assert resp.json()["status"] == "in_review"
        finally:
            app.dependency_overrides.clear()

    def test_employee_cannot_update_feedback(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                emp = _make_user(db, "emp")
                alice = _make_user(db, "alice")
                db.flush()
                fb = FeedbackRequest(
                    author_id=alice.id, author_username="alice",
                    type=FeedbackType.BUG, status=FeedbackStatus.NEW,
                    title="Bug", description="...",
                )
                db.add(fb)
                db.commit()
                fb_id = fb.id

            resp = client.put(f"/api/feedback/admin/{fb_id}", json={
                "status": "resolved",
            }, headers=_auth("emp"))
            assert resp.status_code == 403
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Reference data (auth required)
# ===========================================================================

class TestReferenceData:
    def test_reference_requires_auth(self):
        client, _ = _setup()
        try:
            resp = client.get("/api/reference")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    def test_reference_returns_data(self):
        client, SessionLocal = _setup()
        try:
            with SessionLocal() as db:
                _make_user(db, "alice")
                db.commit()

            resp = client.get("/api/reference", headers=_auth("alice"))
            assert resp.status_code == 200
            assert isinstance(resp.json(), dict)
        finally:
            app.dependency_overrides.clear()
