from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Epic,
    EpicQA,
    EpicQAStatus,
    EpicTestRun,
    Project,
    Release,
    ReleaseEpicMembership,
    ReleaseStatus,
    TestRunStatus as RunStatus,
    User,
    UserRole,
)
from app.release_service import build_release_assessment, safe_audit_details
from app.routers.releases import create_release, transition_release
from app.schemas import ReleaseCreate, ReleaseTransitionRequest


def _session():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def _data(db):
    project = Project(name="Release project")
    coordinator = User(
        username="release-coord", password_hash="x", role=UserRole.COORDINATOR,
        is_approved=True, direction="qa",
    )
    coordinator.projects = [project]
    db.add_all([project, coordinator])
    db.flush()
    epic = Epic(project_id=project.id, title="Epic", jira_url="https://jira/E-1", confluence_url="")
    db.add(epic)
    db.flush()
    db.add(EpicQA(
        epic_id=epic.id, status=EpicQAStatus.DRAFT.value.upper(),
        active_test_stage="test", test_plan_items=[],
    ))
    db.commit()
    return project, coordinator, epic


def test_empty_release_and_project_scoped_sequence():
    with _session() as db:
        project, coordinator, _ = _data(db)
        first = create_release(ReleaseCreate(project_id=project.id, title="First"), coordinator, db)
        second = create_release(ReleaseCreate(project_id=project.id, title="Second"), coordinator, db)
        assert first.key == "REL-001"
        assert second.key == "REL-002"
        assert first.epic_count == 0


def test_membership_becomes_inactive_after_release_but_stays_historical():
    with _session() as db:
        project, coordinator, epic = _data(db)
        created = create_release(ReleaseCreate(project_id=project.id, title="R", epic_ids=[epic.id]), coordinator, db)
        release = db.get(Release, created.id)
        release.status = ReleaseStatus.READY
        db.commit()
        transition_release(
            release.id,
            ReleaseTransitionRequest(target_status="released", release_note="done"),
            coordinator,
            db,
        )
        membership = db.scalar(select(ReleaseEpicMembership).where(ReleaseEpicMembership.release_id == release.id))
        assert membership is not None
        assert membership.is_active is False
        assert membership.removed_at is None
        assert db.get(Release, release.id).released_at is not None


def test_qa_incompleteness_is_warning_early_and_risk_for_ready_target():
    with _session() as db:
        project, coordinator, epic = _data(db)
        run = EpicTestRun(
            id=100, epic_id=epic.id, environment="test", status=RunStatus.PASSED.value,
            url="https://testops/launch/100",
        )
        db.add(run)
        release = Release(project_id=project.id, sequence_number=1, title="R", created_by_id=coordinator.id)
        db.add(release)
        db.flush()
        db.add(ReleaseEpicMembership(release_id=release.id, epic_id=epic.id, added_by_id=coordinator.id))
        db.commit()
        db.refresh(release)

        current = build_release_assessment(db, release)
        target = build_release_assessment(db, release, target_status=ReleaseStatus.READY)
        assert any(item["kind"] == "qa_incomplete" for item in current["warnings"])
        assert not any(item["kind"] == "qa_incomplete" for item in current["actual_risks"])
        assert any(item["kind"] == "qa_incomplete" for item in target["actual_risks"])


def test_release_audit_details_are_allow_listed_and_truncated():
    details = safe_audit_details({
        "outcome": "partial",
        "message": "x" * 1000,
        "headers": {"Authorization": "secret"},
        "payload": {"token": "secret"},
        "error_code": "upstream_error",
    })
    assert details["outcome"] == "partial"
    assert details["error_code"] == "upstream_error"
    assert len(details["message"]) == 500
    assert "headers" not in details
    assert "payload" not in details
