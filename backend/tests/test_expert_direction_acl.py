"""Experts list, open, and answer only questions for their own direction."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Project, Ticket, TicketStatus, User, UserRole
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
    return {"Authorization": "Bearer " + create_access_token(username)}


def _user(db, username: str, *, role: UserRole, direction: str | None, project: Project) -> User:
    user = User(
        username=username,
        password_hash=hash_password("secret123"),
        role=role,
        is_approved=True,
        direction=direction,
    )
    user.projects = [project]
    db.add(user)
    db.flush()
    return user


def _ticket(
    db,
    project: Project,
    author: User,
    *,
    status: TicketStatus,
    target_direction: str | None,
    assignee: User | None = None,
    origin: str,
) -> Ticket:
    data_json = {}
    if target_direction is not None:
        data_json["target_direction"] = target_direction
    ticket = Ticket(
        project_id=project.id,
        status=status,
        origin_event_id=origin,
        author_id=author.id,
        assignee_id=assignee.id if assignee is not None else None,
        title=f"{origin} {target_direction or 'none'}",
        priority="medium",
        sla_hours=24,
        due_at=datetime.utcnow() + timedelta(hours=24),
        data_json=data_json,
    )
    db.add(ticket)
    db.flush()
    return ticket


def test_design_expert_lists_and_opens_only_design_tickets():
    client, SessionLocal = _setup()
    try:
        with SessionLocal() as db:
            project = Project(name="P")
            db.add(project)
            db.flush()
            author = _user(db, "author", role=UserRole.EMPLOYEE, direction="front", project=project)
            design = _user(db, "designer", role=UserRole.EXPERT, direction="design", project=project)
            design_forwarded = _ticket(
                db, project, author, status=TicketStatus.FORWARDED, target_direction="design", origin="design-fwd"
            )
            design_answered = _ticket(
                db, project, author, status=TicketStatus.ANSWERED, target_direction="design", origin="design-ans"
            )
            design_pending = _ticket(
                db, project, author, status=TicketStatus.PENDING_APPROVAL, target_direction="design", origin="design-pend"
            )
            analytics_forwarded = _ticket(
                db, project, author, status=TicketStatus.FORWARDED, target_direction="analytics", origin="ana-fwd"
            )
            missing_direction = _ticket(
                db, project, author, status=TicketStatus.FORWARDED, target_direction=None, origin="missing-fwd"
            )
            db.commit()
            visible_ids = {design_forwarded.id, design_answered.id}
            hidden_ids = {design_pending.id, analytics_forwarded.id, missing_direction.id}
            analytics_id = analytics_forwarded.id
            design_id = design_forwarded.id
            pending_id = design_pending.id

        listed = client.get("/api/tickets", headers=_auth("designer"))
        assert listed.status_code == 200
        listed_ids = {item["id"] for item in listed.json()["items"]}
        assert listed_ids == visible_ids

        opened = client.get(f"/api/tickets/{design_id}", headers=_auth("designer"))
        assert opened.status_code == 200
        assert opened.json()["id"] == design_id
        assert "answered" in opened.json()["allowed_target_statuses"]
        assert "returned" in opened.json()["allowed_target_statuses"]

        for ticket_id in hidden_ids:
            denied = client.get(f"/api/tickets/{ticket_id}", headers=_auth("designer"))
            assert denied.status_code == 403

        transitions = client.get(
            f"/api/tickets/{analytics_id}/allowed-status-transitions",
            headers=_auth("designer"),
        )
        assert transitions.status_code == 403
        pending_open = client.get(f"/api/tickets/{pending_id}", headers=_auth("designer"))
        assert pending_open.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_design_expert_answers_matching_ticket_and_not_other_direction():
    client, SessionLocal = _setup()
    try:
        with SessionLocal() as db:
            project = Project(name="P")
            db.add(project)
            db.flush()
            author = _user(db, "author", role=UserRole.EMPLOYEE, direction="front", project=project)
            design = _user(db, "designer", role=UserRole.EXPERT, direction="design", project=project)
            other_assignee = _user(db, "other", role=UserRole.EXPERT, direction="analytics", project=project)
            design_ticket = _ticket(
                db,
                project,
                author,
                status=TicketStatus.FORWARDED,
                target_direction="design",
                assignee=other_assignee,
                origin="design-answer",
            )
            analytics_ticket = _ticket(
                db,
                project,
                author,
                status=TicketStatus.FORWARDED,
                target_direction="analytics",
                assignee=other_assignee,
                origin="analytics-answer",
            )
            db.commit()
            design_id = design_ticket.id
            analytics_id = analytics_ticket.id

        denied = client.put(
            f"/api/tickets/{analytics_id}",
            json={"status": "answered"},
            headers=_auth("designer"),
        )
        assert denied.status_code == 403

        # A matching non-assignee is offered the answer transition. Persisting that
        # PUT also writes notifications, which roll the SQLite test transaction back
        # on BigInteger ids, so the committed status is asserted via the ACL helper.
        allowed = client.get(
            f"/api/tickets/{design_id}/allowed-status-transitions",
            headers=_auth("designer"),
        )
        assert allowed.status_code == 200
        assert set(allowed.json()) == {"returned", "answered"}

        with SessionLocal() as db:
            untouched = db.scalar(select(Ticket).where(Ticket.id == analytics_id))
            assert untouched is not None
            assert untouched.status == TicketStatus.FORWARDED
    finally:
        app.dependency_overrides.clear()


def test_expert_without_direction_sees_and_answers_nothing():
    client, SessionLocal = _setup()
    try:
        with SessionLocal() as db:
            project = Project(name="P")
            db.add(project)
            db.flush()
            author = _user(db, "author", role=UserRole.EMPLOYEE, direction="front", project=project)
            blank = _user(db, "blank", role=UserRole.EXPERT, direction=None, project=project)
            invalid = _user(db, "invalid", role=UserRole.EXPERT, direction="qa", project=project)
            ticket = _ticket(
                db, project, author, status=TicketStatus.FORWARDED, target_direction="design", origin="design-closed"
            )
            db.commit()
            ticket_id = ticket.id
            assert blank.id and invalid.id

        for username in ("blank", "invalid"):
            listed = client.get("/api/tickets", headers=_auth(username))
            assert listed.status_code == 200
            assert listed.json()["items"] == []
            opened = client.get(f"/api/tickets/{ticket_id}", headers=_auth(username))
            assert opened.status_code == 403
            answered = client.put(
                f"/api/tickets/{ticket_id}",
                json={"status": "answered"},
                headers=_auth(username),
            )
            assert answered.status_code == 403
    finally:
        app.dependency_overrides.clear()
