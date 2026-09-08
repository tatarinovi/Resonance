from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime
import hashlib
import json
import re
import threading
import time
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..release_classification import status_group, priority_group, latest_issues, issue_rank
from ..release_sources import kanban_scope, kanban_source
from ..epic_testops_service import snapshot_read, problem_case_read
from ..access_policy import AccessPolicy
from ..config import get_settings
from ..database import SessionLocal, get_db
from ..deps import get_current_user
from ..epic_jira_service import fetch_jira_issues, mark_jira_refresh_failure, replace_jira_issues
from ..epic_testops_service import fetch_testops_run, mark_testops_refresh_failure, parse_testops_launch_id, replace_testops_snapshot
from ..integration_service import require_global_kanban_token
from ..kanban_client import KanbanClient, parse_kanban_reference
from ..models import (
    AppSetting,
    Epic,
    EpicExternalSyncState,
    EpicJiraIssue,
    EpicTestOpsProblemCase,
    EpicTestOpsSnapshot,
    EpicTestRun,
    Project,
    Release,
    ReleaseSequenceCounter,
    ReleaseAuditLog,
    ReleaseEpicMembership,
    ReleaseStatus,
    ScopedAnalyticsSnapshot,
    Ticket,
    TicketStatus,
    User,
    UserRole,
)
from ..realtime import publish_broadcast
from ..release_service import (
    ACTIVE_RELEASE_STATUSES,
    TERMINAL_RELEASE_STATUSES,
    add_release_audit,
    build_release_assessment,
    current_epics,
    current_memberships,
    kanban_freshness,
    release_query,
    release_status,
    release_to_read,
    status_value,
)
from ..schemas import (
    ReleaseAuditPaginationResponse,
    ReleaseAuditRead,
    ReleaseCreate,
    ReleaseEpicOption,
    ReleaseEpicOptionsResponse,
    ReleaseMembershipRequest,
    ReleasePaginationResponse,
    ReleaseRead,
    ReleaseTransitionRequest,
    ReleaseUpdate,
)


router = APIRouter(prefix="/releases", tags=["releases"])
_refresh_locks_guard = threading.Lock()
_refresh_locks: dict[int, threading.Lock] = {}


def _lock_for(release_id: int) -> threading.Lock:
    with _refresh_locks_guard:
        return _refresh_locks.setdefault(release_id, threading.Lock())


def _release_or_404(db: Session, release_id: int, user: User) -> Release:
    release = db.scalar(release_query().where(Release.id == release_id))
    if not release or not AccessPolicy.can_view_release(user, release):
        raise HTTPException(status_code=404, detail="Release not found")
    return release


def _require_manage(user: User, release: Release) -> None:
    if not AccessPolicy.can_manage_release(user, release):
        raise HTTPException(status_code=403, detail="Only coordinators and admins can manage releases")


def _validate_owner(db: Session, project_id: int, owner_user_id: int | None) -> None:
    if owner_user_id is None:
        return
    owner = db.scalar(select(User).options(selectinload(User.projects)).where(User.id == owner_user_id))
    if not owner or not owner.is_approved:
        raise HTTPException(status_code=422, detail="Release owner is unavailable")
    if owner.role != UserRole.ADMIN and not any(project.id == project_id for project in owner.projects):
        raise HTTPException(status_code=422, detail="Release owner must belong to the project")


def _add_memberships(
    db: Session,
    release: Release,
    epic_ids: list[int],
    user: User,
    *,
    correction_reason: str | None = None,
) -> list[int]:
    terminal = release_status(release.status) in TERMINAL_RELEASE_STATUSES
    if terminal and (user.role != UserRole.ADMIN or not (correction_reason or "").strip()):
        raise HTTPException(status_code=409, detail="Terminal release membership correction requires an admin reason")
    unique_ids = list(dict.fromkeys(epic_ids))
    epics = list(db.scalars(select(Epic).where(Epic.id.in_(unique_ids))).all()) if unique_ids else []
    if len(epics) != len(unique_ids):
        raise HTTPException(status_code=422, detail="One or more epics were not found")
    if any(epic.project_id != release.project_id for epic in epics):
        raise HTTPException(status_code=422, detail="All epics must belong to the release project")
    if not terminal:
        active = list(db.scalars(select(ReleaseEpicMembership).where(
            ReleaseEpicMembership.epic_id.in_(unique_ids), ReleaseEpicMembership.is_active.is_(True)
        )).all()) if unique_ids else []
        conflicts = [membership.epic_id for membership in active if membership.release_id != release.id]
        if conflicts:
            raise HTTPException(status_code=409, detail={"message": "Epic already belongs to another active release", "epic_ids": conflicts})
    existing_current = {membership.epic_id for membership in current_memberships(release)}
    added: list[int] = []
    for epic in epics:
        if epic.id in existing_current:
            continue
        db.add(ReleaseEpicMembership(
            release_id=release.id,
            epic_id=epic.id,
            added_by_id=user.id,
            is_active=not terminal,
        ))
        added.append(epic.id)
    if added:
        add_release_audit(db, release, user, "epics_added", {
            "epic_ids": added,
            "reason": correction_reason,
        })
    return added


@router.get("", response_model=ReleasePaginationResponse)
def list_releases(
    q: str | None = None,
    project_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    owner_user_id: int | None = None,
    planned_from: datetime | None = None,
    planned_to: datetime | None = None,
    overdue: bool | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReleasePaginationResponse:
    stmt = release_query().order_by(Release.updated_at.desc(), Release.id.desc())
    if user.role != UserRole.ADMIN:
        allowed = AccessPolicy.get_allowed_project_ids(user)
        if not allowed:
            return ReleasePaginationResponse(items=[], total=0, page=page, page_size=page_size)
        stmt = stmt.where(Release.project_id.in_(allowed))
    if project_id is not None:
        if not AccessPolicy.has_project_access(user, project_id):
            raise HTTPException(status_code=403, detail="Project access denied")
        stmt = stmt.where(Release.project_id == project_id)
    stmt = stmt.where(Release.archived_at.is_not(None) if archived else Release.archived_at.is_(None))
    if status_filter:
        try:
            stmt = stmt.where(Release.status == release_status(status_filter))
        except (KeyError, ValueError):
            raise HTTPException(status_code=422, detail="Unknown release status") from None
    if owner_user_id is not None:
        stmt = stmt.where(Release.owner_user_id == owner_user_id)
    if planned_from is not None:
        stmt = stmt.where(Release.planned_release_at >= planned_from)
    if planned_to is not None:
        stmt = stmt.where(Release.planned_release_at <= planned_to)
    if overdue is not None:
        condition = (Release.planned_release_at < datetime.utcnow()) & Release.status.in_(list(ACTIVE_RELEASE_STATUSES))
        stmt = stmt.where(condition if overdue else ~condition)
    search = (q or "").strip()
    if search:
        match = re.fullmatch(r"REL-(\d+)", search, re.IGNORECASE)
        key_condition = Release.sequence_number == int(match.group(1)) if match else False
        stmt = stmt.where(or_(Release.title.ilike(f"%{search}%"), key_condition))
    total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).unique().all()
    return ReleasePaginationResponse(
        items=[release_to_read(db, row, user, include_epics=False) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=ReleaseRead, status_code=status.HTTP_201_CREATED)
def create_release(
    payload: ReleaseCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReleaseRead:
    project = db.scalar(select(Project).where(Project.id == payload.project_id).with_for_update())
    if not project:
        raise HTTPException(status_code=422, detail="Project not found")
    probe = Release(project_id=project.id, sequence_number=0, title=payload.title)
    if not AccessPolicy.can_manage_release(user, probe):
        raise HTTPException(status_code=403, detail="Only coordinators and admins can create releases")
    _validate_owner(db, project.id, payload.owner_user_id)
    counter = db.scalar(select(ReleaseSequenceCounter).where(ReleaseSequenceCounter.id == 1).with_for_update())
    if counter is None:
        counter = ReleaseSequenceCounter(
            id=1,
            next_value=int(db.scalar(select(func.max(Release.sequence_number))) or 0) + 1,
        )
        db.add(counter)
        db.flush()
    sequence = counter.next_value
    counter.next_value += 1
    release = Release(
        project_id=project.id,
        sequence_number=sequence,
        title=payload.title.strip(),
        description=payload.description,
        planned_release_at=payload.planned_release_at,
        owner_user_id=payload.owner_user_id,
        created_by_id=user.id,
        status=ReleaseStatus.DRAFT,
    )
    db.add(release)
    db.flush()
    add_release_audit(db, release, user, "created", {"new_status": ReleaseStatus.DRAFT.value})
    _add_memberships(db, release, payload.epic_ids, user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Release or Epic membership changed concurrently") from None
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    publish_broadcast("release.created", {"release_id": release.id, "project_id": release.project_id})
    return release_to_read(db, refreshed, user)


@router.get("/epic-options", response_model=ReleaseEpicOptionsResponse)
def release_epic_options(
    project_id: int,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReleaseEpicOptionsResponse:
    if not AccessPolicy.has_project_access(user, project_id):
        raise HTTPException(status_code=403, detail="Project access denied")
    stmt = select(Epic).where(Epic.project_id == project_id).order_by(Epic.updated_at.desc())
    if (q or "").strip():
        stmt = stmt.where(Epic.title.ilike(f"%{q.strip()}%"))
    total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    epics = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all())
    active = list(db.scalars(
        select(ReleaseEpicMembership)
        .options(selectinload(ReleaseEpicMembership.release))
        .where(ReleaseEpicMembership.epic_id.in_([epic.id for epic in epics]), ReleaseEpicMembership.is_active.is_(True))
    ).all()) if epics else []
    by_epic = {membership.epic_id: membership.release for membership in active}
    items = []
    for epic in epics:
        linked = by_epic.get(epic.id)
        active_read = None
        if linked:
            active_read = {"id": linked.id, "key": linked.key, "title": linked.title, "status": status_value(linked.status)}
        items.append(ReleaseEpicOption(
            id=epic.id, key=f"EP-{epic.id:03d}", title=epic.title,
            status=epic.status.value if hasattr(epic.status, "value") else str(epic.status).lower(),
            project_id=epic.project_id, available=linked is None,
            disabled_reason="Epic уже находится в активном релизе" if linked else None,
            active_release=active_read,
        ))
    return ReleaseEpicOptionsResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{release_id}", response_model=ReleaseRead)
def get_release(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ReleaseRead:
    return release_to_read(db, _release_or_404(db, release_id, user), user)


@router.patch("/{release_id}", response_model=ReleaseRead)
def update_release(release_id: int, payload: ReleaseUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ReleaseRead:
    release = _release_or_404(db, release_id, user)
    _require_manage(user, release)
    data = payload.model_dump(exclude_unset=True)
    if release_status(release.status) in TERMINAL_RELEASE_STATUSES and user.role != UserRole.ADMIN:
        forbidden = set(data) - {"release_note"}
        if forbidden:
            raise HTTPException(status_code=409, detail="Only release note can be edited after completion")
    if "owner_user_id" in data:
        _validate_owner(db, release.project_id, data["owner_user_id"])
    for field, value in data.items():
        setattr(release, field, value.strip() if field == "title" and value else value)
    if data:
        add_release_audit(db, release, user, "updated", {"fields": sorted(data)})
    db.commit()
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    publish_broadcast("release.updated", {"release_id": release.id, "project_id": release.project_id})
    return release_to_read(db, refreshed, user)


@router.post("/{release_id}/status-transitions", response_model=dict)
def transition_release(release_id: int, payload: ReleaseTransitionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    release = _release_or_404(db, release_id, user)
    _require_manage(user, release)
    target = release_status(payload.target_status)
    if target not in AccessPolicy.release_allowed_transitions(release):
        raise HTTPException(status_code=409, detail="Release status transition is not allowed")
    old = release_status(release.status)
    assessment = build_release_assessment(db, release, target_status=target)
    if target in {ReleaseStatus.READY, ReleaseStatus.RELEASED} and assessment["actual_risks"]:
        if not payload.accept_risks or payload.risk_fingerprint != assessment["risk_fingerprint"]:
            raise HTTPException(status_code=409, detail="Состав рисков изменился или не подтверждён. Просмотрите оценку и подтвердите принятие рисков.")
    release.status = target
    if target == ReleaseStatus.RELEASED:
        release.released_at = datetime.utcnow()
    if target in TERMINAL_RELEASE_STATUSES:
        if payload.release_note is not None:
            release.release_note = payload.release_note
        for membership in current_memberships(release):
            membership.is_active = False
    add_release_audit(db, release, user, "status_changed", {
        "accepted_risks": [item["id"] + ": " + item["message"] for item in assessment["actual_risks"]] if payload.accept_risks else [],
        "risk_fingerprint": assessment["risk_fingerprint"],
        "old_status": old.value,
        "new_status": target.value,
    })
    db.commit()
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    publish_broadcast("release.updated", {"release_id": release.id, "project_id": release.project_id, "kind": "status"})
    return {"release": release_to_read(db, refreshed, user).model_dump(), "assessment": assessment}


@router.post("/{release_id}/epics", response_model=ReleaseRead)
def add_release_epics(release_id: int, payload: ReleaseMembershipRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ReleaseRead:
    release = _release_or_404(db, release_id, user)
    _require_manage(user, release)
    _add_memberships(db, release, payload.epic_ids, user, correction_reason=payload.correction_reason)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Epic already belongs to another active release") from None
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    publish_broadcast("release.updated", {"release_id": release.id, "project_id": release.project_id, "kind": "membership"})
    return release_to_read(db, refreshed, user)


@router.delete("/{release_id}/epics/{epic_id}", response_model=ReleaseRead)
def remove_release_epic(
    release_id: int,
    epic_id: int,
    correction_reason: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReleaseRead:
    release = _release_or_404(db, release_id, user)
    _require_manage(user, release)
    terminal = release_status(release.status) in TERMINAL_RELEASE_STATUSES
    if terminal and (user.role != UserRole.ADMIN or not (correction_reason or "").strip()):
        raise HTTPException(status_code=409, detail="Terminal release membership correction requires an admin reason")
    membership = next((item for item in current_memberships(release) if item.epic_id == epic_id), None)
    if not membership:
        raise HTTPException(status_code=404, detail="Epic membership not found")
    membership.is_active = False
    membership.removed_at = datetime.utcnow()
    membership.removed_by_id = user.id
    add_release_audit(db, release, user, "epic_removed", {"epic_id": epic_id, "reason": correction_reason})
    db.commit()
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    publish_broadcast("release.updated", {"release_id": release.id, "project_id": release.project_id, "kind": "membership"})
    return release_to_read(db, refreshed, user)


@router.post("/{release_id}/archive", response_model=ReleaseRead)
def archive_release(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ReleaseRead:
    release = _release_or_404(db, release_id, user)
    if user.role != UserRole.ADMIN or release_status(release.status) not in TERMINAL_RELEASE_STATUSES:
        raise HTTPException(status_code=403, detail="Only completed releases can be archived by an admin")
    release.archived_at = datetime.utcnow()
    release.archived_by_id = user.id
    add_release_audit(db, release, user, "archived", {"archived": True})
    db.commit()
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    return release_to_read(db, refreshed, user)


@router.post("/{release_id}/unarchive", response_model=ReleaseRead)
def unarchive_release(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ReleaseRead:
    release = _release_or_404(db, release_id, user)
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    release.archived_at = None
    release.archived_by_id = None
    add_release_audit(db, release, user, "unarchived", {"archived": False})
    db.commit()
    refreshed = db.scalar(release_query().where(Release.id == release.id))
    return release_to_read(db, refreshed, user)


@router.delete("/{release_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_release(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    release = _release_or_404(db, release_id, user)
    if user.role != UserRole.ADMIN or release_status(release.status) != ReleaseStatus.DRAFT:
        raise HTTPException(status_code=403, detail="Only draft releases can be deleted by an admin")
    project_id = release.project_id
    db.delete(release)
    db.commit()
    publish_broadcast("release.deleted", {"release_id": release_id, "project_id": project_id})


@router.get("/{release_id}/history", response_model=ReleaseAuditPaginationResponse)
def release_history(
    release_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReleaseAuditPaginationResponse:
    _release_or_404(db, release_id, user)
    stmt = select(ReleaseAuditLog).options(selectinload(ReleaseAuditLog.actor)).where(
        ReleaseAuditLog.release_id == release_id
    ).order_by(ReleaseAuditLog.created_at.desc(), ReleaseAuditLog.id.desc())
    total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return ReleaseAuditPaginationResponse(items=[ReleaseAuditRead(
        id=row.id, release_id=row.release_id, actor_user_id=row.actor_user_id,
        actor_username=row.actor.username if row.actor else None, action=row.action,
        details_json=row.details_json or {}, created_at=row.created_at,
    ) for row in rows], total=total, page=page, page_size=page_size)


@router.get("/{release_id}/overview")
def release_overview(
    release_id: int,
    target_status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    target = release_status(target_status) if target_status else None
    assessment = build_release_assessment(db, release, target_status=target)
    return {
        **assessment,
        "release": release_to_read(db, release, user).model_dump(),
        "target_assessment": assessment if target else None,
    }


@router.get("/{release_id}/tasks")
def release_tasks(
    release_id: int,
    q: str | None = None,
    epic_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    status_group_filter: str | None = Query(None, alias="status_group"),
    priority_group_filter: str | None = Query(None, alias="priority_group"),
    sort: str = "priority",
    assignee: str | None = None,
    issue_type: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    epics = current_epics(release)
    allowed_ids = {epic.id for epic in epics}
    rows = db.scalars(select(EpicJiraIssue).where(EpicJiraIssue.epic_id.in_(allowed_ids))).all() if allowed_ids else []
    epic_map = {epic.id: {"id": epic.id, "key": f"EP-{epic.id:03d}", "title": epic.title} for epic in epics}
    deduped = latest_issues(rows)
    items = [{"key": row.jira_issue_key, "title": row.summary, "status": row.status,
              "status_group": status_group(row.status, row.status_category),
              "is_done": status_group(row.status, row.status_category) == "done",
              "priority_group": priority_group(row.priority), "priority": row.priority,
              "assignee": row.assignee_display_name, "issue_type": row.issue_type,
              "url": row.browser_url, "refreshed_at": row.refreshed_at,
              "source_epics": [epic_map[i] for i in sorted({r.epic_id for r in rows if r.jira_issue_key == row.jira_issue_key})]}
             for row in deduped.values()]
    facets = {key: sorted({str(item[key]) for item in items if item.get(key)}) for key in ("status", "priority", "assignee", "issue_type")}
    if epic_id is not None:
        items = [item for item in items if any(e["id"] == epic_id for e in item["source_epics"])]
    if status_group_filter:
        items = [item for item in items if item["status_group"] == status_group_filter]
    if priority_group_filter:
        items = [item for item in items if item["priority_group"] == priority_group_filter and not item["is_done"]]
    lowered = (q or "").strip().casefold()
    if lowered:
        items = [item for item in items if lowered in f"{item['key']} {item['title']}".casefold()]
    for key, expected in (("status", status_filter), ("priority", priority), ("assignee", assignee), ("issue_type", issue_type)):
        if expected:
            items = [item for item in items if str(item.get(key) or "").casefold() == expected.casefold()]
    if sort not in {"priority", "key", "status"}:
        raise HTTPException(status_code=422, detail="Неизвестная сортировка")
    items.sort(key=lambda item: (item["is_done"], item["key"] if sort == "key" else str(item["status"] or "") if sort == "status" else issue_rank(deduped[item["key"]])[1], item["key"]))
    total = len(items)
    return {"items": items[(page - 1) * page_size:page * page_size], "total": total, "page": page, "page_size": page_size, "facets": facets}


@router.get("/{release_id}/qa")
def release_qa(
    release_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    epics = sorted(current_epics(release), key=lambda item: item.id)
    total = len(epics)
    selected = epics[(page - 1) * page_size:page * page_size]
    items = []
    for epic in selected:
        runs = []
        for run in epic.test_runs or []:
            snapshot = db.get(EpicTestOpsSnapshot, run.id)
            runs.append({
                "id": run.id, "environment": run.environment, "status": run.status, "url": run.url,
                "started_at": run.started_at, "finished_at": run.finished_at,
                "testops_launch_id": run.testops_launch_id,
                "testops_snapshot": snapshot_read(snapshot),
            })
        items.append({
            "epic": {"id": epic.id, "key": f"EP-{epic.id:03d}", "title": epic.title},
            "qa_status": str(epic.qa_block.status).lower() if epic.qa_block else None,
            "active_test_stage": epic.qa_block.active_test_stage if epic.qa_block else None,
            "runs": runs,
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{release_id}/qa/results")
def release_qa_results(release_id: int, run_id: int | None = None, result_status: str | None = None,
                       active_only: bool = False, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    release = _release_or_404(db, release_id, user)
    runs = {run.id: (epic, run) for epic in current_epics(release) for run in epic.test_runs
            if (run_id is None or run.id == run_id) and (not active_only or run.environment == (epic.qa_block.active_test_stage if epic.qa_block else 'test'))}
    stmt = select(EpicTestOpsProblemCase).where(EpicTestOpsProblemCase.test_run_id.in_(runs))
    if result_status:
        stmt = stmt.where(EpicTestOpsProblemCase.status == result_status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    cases = db.scalars(stmt.order_by(EpicTestOpsProblemCase.test_run_id, EpicTestOpsProblemCase.id).offset((page-1)*page_size).limit(page_size)).all()
    return {"items": [{**problem_case_read(c), "run_id": c.test_run_id, "epic_key": f"EP-{runs[c.test_run_id][0].id:03d}", "environment": runs[c.test_run_id][1].environment} for c in cases], "total": total, "page": page, "page_size": page_size}


@router.get("/{release_id}/questions")
def release_questions(
    release_id: int,
    q: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    view: str | None = None,
    epic_id: int | None = None,
    expert_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    epic_map = {epic.id: epic for epic in current_epics(release)}
    ids = set(epic_map)
    if epic_id is not None:
        ids &= {epic_id}
    stmt = select(Ticket).options(selectinload(Ticket.assignee), selectinload(Ticket.author)).where(Ticket.epic_id.in_(ids))
    experts = db.execute(select(User.id, User.username).join(Ticket, Ticket.assignee_id == User.id).where(Ticket.epic_id.in_(ids)).distinct().order_by(User.username)).all()
    if view in {"open", "overdue", "waiting"}:
        stmt = stmt.where(Ticket.status.in_([TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, TicketStatus.RETURNED]))
    if view == "overdue":
        stmt = stmt.where(Ticket.due_at < datetime.utcnow())
    if view == "waiting":
        stmt = stmt.where(Ticket.status == TicketStatus.FORWARDED)
    if status_filter:
        try:
            stmt = stmt.where(Ticket.status == TicketStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=422, detail="Unknown question status") from None
    if expert_id is not None:
        stmt = stmt.where(Ticket.assignee_id == expert_id)
    if (q or "").strip():
        search = f"%{q.strip()}%"
        stmt = stmt.where(or_(Ticket.title.ilike(search), Ticket.description.ilike(search)))
    total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    rows = db.scalars(stmt.order_by(Ticket.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    items = [{
        "id": row.id, "key": f"Q-{row.id:03d}", "status": row.status.value,
        "title": row.title or row.description or f"Question Q-{row.id:03d}",
        "expert": None if not row.assignee else {"id": row.assignee.id, "username": row.assignee.username},
        "source_epic": {"id": row.epic_id, "key": f"EP-{row.epic_id:03d}", "title": epic_map[row.epic_id].title},
        "created_at": row.created_at, "updated_at": row.updated_at, "due_at": row.due_at,
        "overdue": bool(row.due_at and row.due_at < datetime.utcnow() and row.status not in {TicketStatus.ANSWERED, TicketStatus.CLOSED, TicketStatus.CANCELLED}),
        "url": f"/questions/Q-{row.id:03d}",
    } for row in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "experts": [{"id": row.id, "username": row.username} for row in experts]}


def _release_kanban_details(db: Session, release: Release) -> tuple[list[dict], dict]:
    key, _, _ = kanban_scope(release)
    row = db.get(ScopedAnalyticsSnapshot, key)
    epic_map = {e.id: {"id": e.id, "key": f"EP-{e.id:03d}", "title": e.title} for e in current_epics(release)}
    items = (row.data_json or {}).get("items", []) if row else []
    return [{**item, "resonance_epic": epic_map[item["epic_id"]]} for item in items if item["epic_id"] in epic_map], kanban_source(db, release)


@router.get("/{release_id}/time-management/summary")
def release_time_summary(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    release = _release_or_404(db, release_id, user)
    details, freshness = _release_kanban_details(db, release)
    by_user: dict[str, float] = {}
    by_epic: list[dict] = []
    by_day: dict[str, float] = {}
    total = 0.0
    for detail in details:
        hours = float((detail.get("summary") or {}).get("tracked_hours") or 0)
        total += hours
        by_epic.append({**detail["resonance_epic"], "hours": hours})
        for row in detail.get("worklogs") or []:
            value = float(row.get("hours") or 0)
            name = str(row.get("user_name") or "Unknown")
            by_user[name] = by_user.get(name, 0) + value
            day = str(row.get("begin") or "")[:10]
            if day:
                by_day[day] = by_day.get(day, 0) + value
    return {
        "summary": {"spent_hours": round(total, 2), "epic_count": len(details)},
        "by_epic": by_epic,
        "by_user": [{"name": key, "hours": round(value, 2)} for key, value in sorted(by_user.items(), key=lambda item: item[1], reverse=True)],
        "dynamics": [{"day": key, "hours": round(value, 2)} for key, value in sorted(by_day.items())],
        "freshness": freshness,
    }


@router.get("/{release_id}/time-management/tasks")
def release_time_tasks(
    release_id: int, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    details, freshness = _release_kanban_details(db, release)
    items = [{**task, "source_epic": detail["resonance_epic"]} for detail in details for task in detail.get("tasks") or []]
    total = len(items)
    return {"items": items[(page - 1) * page_size:page * page_size], "total": total, "page": page, "page_size": page_size, "freshness": freshness}


@router.get("/{release_id}/time-management/worklogs")
def release_time_worklogs(
    release_id: int, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    release = _release_or_404(db, release_id, user)
    details, freshness = _release_kanban_details(db, release)
    items = [{**row, "source_epic": detail["resonance_epic"]} for detail in details for row in detail.get("worklogs") or []]
    items.sort(key=lambda item: item.get("begin") or "", reverse=True)
    total = len(items)
    return {"items": items[(page - 1) * page_size:page * page_size], "total": total, "page": page, "page_size": page_size, "freshness": freshness}


def _safe_refresh_error(exc: BaseException) -> tuple[str, str]:
    if isinstance(exc, HTTPException):
        code = {409: "not_configured", 502: "upstream_error", 504: "timeout"}.get(exc.status_code, "refresh_failed")
        return code, str(exc.detail)[:500]
    return "unexpected_error", "Unexpected refresh failure."


def _refresh_operation(epic_id: int, source: str, deadline: float) -> dict:
    with SessionLocal() as worker_db:
        epic = worker_db.scalar(select(Epic).options(selectinload(Epic.test_runs)).where(Epic.id == epic_id))
        if not epic:
            return {"epic_id": epic_id, "source": source, "status": "failed", "error_code": "not_found", "message": "Epic not found"}
        sync_state = worker_db.scalar(select(EpicExternalSyncState).where(
            EpicExternalSyncState.epic_id == epic_id,
            EpicExternalSyncState.source == source,
        ))
        previous = sync_state.last_success_at if sync_state else None
        try:
            if time.monotonic() >= deadline:
                return {"epic_id": epic_id, "source": source, "status": "timed_out", "error_code": "wall_clock_timeout", "message": "Release refresh wall-clock budget exceeded", "previous_success_at": previous, "current_success_at": previous}
            if source == "jira":
                if not (epic.jira_jql or "").strip():
                    return {"epic_id": epic_id, "source": source, "status": "skipped", "error_code": "not_configured", "message": "Jira JQL is not configured"}
                rows = fetch_jira_issues(worker_db, epic, timeout_seconds=get_settings().release_refresh_request_timeout_seconds, deadline=deadline)
                if time.monotonic() >= deadline:
                    return {"epic_id": epic_id, "source": source, "status": "timed_out", "error_code": "wall_clock_timeout", "message": "Release refresh wall-clock budget exceeded", "previous_success_at": previous, "current_success_at": previous}
                refreshed_at = replace_jira_issues(worker_db, epic, rows)
                return {"epic_id": epic_id, "source": source, "status": "refreshed", "count": len(rows), "previous_success_at": previous, "current_success_at": refreshed_at}
            linked_runs = [run for run in epic.test_runs or [] if run.testops_launch_id or parse_testops_launch_id(run.url)]
            if not linked_runs:
                return {"epic_id": epic_id, "source": source, "status": "skipped", "error_code": "not_configured", "message": "No TestOps launches configured"}
            run_results = []
            for run in linked_runs:
                try:
                    data = fetch_testops_run(worker_db, run, timeout_seconds=get_settings().release_refresh_request_timeout_seconds, deadline=deadline)
                    if time.monotonic() >= deadline:
                        raise HTTPException(status_code=504, detail="TestOps request timed out.")
                    updated = replace_testops_snapshot(worker_db, run, data)
                    run_results.append({"run_id": run.id, "status": "refreshed", "current_success_at": updated})
                except Exception as exc:
                    worker_db.rollback()
                    run.sync_attempt_at = datetime.utcnow()
                    run.sync_error = "Не удалось обновить TestOps. Проверьте подключение и доступность рана."
                    worker_db.commit()
                    run_results.append({"run_id": run.id, "status": "failed", "message": run.sync_error})
            success = sum(item["status"] == "refreshed" for item in run_results)
            result_status = "refreshed" if success == len(run_results) else "partial" if success else "failed"
            if result_status != "refreshed":
                mark_testops_refresh_failure(worker_db, epic_id, "partial" if success else "refresh_failed", "Не все тест-раны обновлены.")
            return {"epic_id": epic_id, "source": source, "status": result_status, "runs": run_results,
                    "previous_success_at": previous, "current_success_at": max((item["current_success_at"] for item in run_results if item["status"] == "refreshed"), default=previous)}
        except Exception as exc:
            code, message = _safe_refresh_error(exc)
            if code == "timeout" and "wall-clock budget" in message.lower():
                return {"epic_id": epic_id, "source": source, "status": "timed_out", "error_code": "wall_clock_timeout", "message": "Release refresh wall-clock budget exceeded", "previous_success_at": previous, "current_success_at": previous}
            if source == "jira":
                mark_jira_refresh_failure(worker_db, epic_id, code, message)
            else:
                mark_testops_refresh_failure(worker_db, epic_id, code, message)
            return {"epic_id": epic_id, "source": source, "status": "failed", "error_code": code, "message": message}


def _refresh_release_kanban_scope(db: Session, release: Release, deadline: float | None = None) -> dict[str, Any]:
    key, scope, refs = kanban_scope(release)
    if not refs:
        return {"status": "skipped", "message": "У эпиков релиза нет ссылок Kanban"}
    row = db.get(ScopedAnalyticsSnapshot, key)
    if row is None:
        row = ScopedAnalyticsSnapshot(scope_hash=key, scope_type="release_overview", scope_json=scope)
        db.add(row)
        db.flush()
    now = datetime.utcnow()
    row.refresh_started_at = now
    row.last_attempt_at = now
    db.commit()
    try:
        client = KanbanClient(token=require_global_kanban_token(db), deadline=deadline)
        items = []
        for epic_id, slug, task_id in refs:
            epic_payload = client.task(task_id)
            embedded = epic_payload.get("epic_by") if isinstance(epic_payload, dict) else None
            tasks = embedded if isinstance(embedded, list) else client.project_list_all(slug, [(f"filter[epic_id][{task_id}]", str(task_id))])
            from .analytics import _worklog_rows_for_task
            worklogs = []
            for task in tasks:
                if isinstance(task, dict) and task.get("id"):
                    worklogs.extend(_worklog_rows_for_task(client, slug, int(task["id"]), task, {}, {}))
            items.append({"epic_id": epic_id, "project_slug": slug, "kanban_epic_id": task_id, "epic": epic_payload, "tasks": tasks,
                          "worklogs": worklogs, "summary": {"tracked_hours": round(sum(w["minutes"] for w in worklogs) / 60, 2)}})
        now = datetime.utcnow()
        row.data_json = {"items": items}
        row.last_success_at = now
        row.last_attempt_at = now
        row.last_attempt_failed = False
        row.error_message = None
        row.refresh_started_at = None
        db.commit()
        return {"status": "success", "count": len(items), "last_success_at": now}
    except Exception:
        row = db.get(ScopedAnalyticsSnapshot, key)
        row.last_attempt_at = datetime.utcnow()
        row.last_attempt_failed = True
        row.error_message = "Не удалось обновить данные Kanban."
        row.refresh_started_at = None
        db.commit()
        return {"status": "failed", "message": row.error_message, "last_success_at": row.last_success_at}


@router.post("/{release_id}/refresh")
def refresh_release(release_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    release = _release_or_404(db, release_id, user)
    _require_manage(user, release)
    if release_status(release.status) not in ACTIVE_RELEASE_STATUSES:
        raise HTTPException(status_code=409, detail="Historical releases cannot be refreshed")
    lock = _lock_for(release_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Release data is already being refreshed")
    started_at = datetime.utcnow()
    settings = get_settings()
    deadline = time.monotonic() + settings.release_refresh_wall_clock_seconds
    operations = [(epic.id, source) for epic in current_epics(release) for source in ("jira", "testops")]
    executor = ThreadPoolExecutor(max_workers=settings.release_refresh_concurrency, thread_name_prefix=f"release-{release_id}")
    try:
        futures = {executor.submit(_refresh_operation, epic_id, source, deadline): (epic_id, source) for epic_id, source in operations}
        done, pending = wait(futures, timeout=settings.release_refresh_wall_clock_seconds)
        results = [future.result() for future in done]
        for future in pending:
            epic_id, source = futures[future]
            future.cancel()
            results.append({"epic_id": epic_id, "source": source, "status": "timed_out", "error_code": "wall_clock_timeout", "message": "Release refresh wall-clock budget exceeded"})
        kanban_result = _refresh_release_kanban_scope(db, release, deadline)
        statuses = [item["status"] for item in results] + [{"success": "refreshed", "skipped": "skipped"}.get(kanban_result["status"], "failed")]
        outcome = "skipped" if all(value == "skipped" for value in statuses) else "success" if statuses and all(value in {"refreshed", "skipped"} for value in statuses) else ("partial" if any(value in {"refreshed", "partial"} for value in statuses) else "failed")
        fresh_release = db.scalar(release_query().where(Release.id == release_id))
        counts = {value: statuses.count(value) for value in set(statuses)}
        add_release_audit(db, fresh_release, user, "data_refreshed", {"outcome": outcome, "counts": counts})
        db.commit()
        publish_broadcast("release.updated", {"release_id": release_id, "project_id": release.project_id, "kind": "refresh"})
        response = {
            "release_id": release_id,
            "outcome": outcome,
            "started_at": started_at,
            "finished_at": datetime.utcnow(),
            "results": sorted(results, key=lambda item: (item["epic_id"], item["source"])),
            "sources": {
                source: {
                    "status": "skipped" if all(item["status"] == "skipped" for item in results if item["source"] == source) else "success" if any(item["source"] == source and item["status"] == "refreshed" for item in results) and not any(item["source"] == source and item["status"] in {"failed", "timed_out", "partial"} for item in results) else ("partial" if any(item["source"] == source and item["status"] in {"refreshed", "partial"} for item in results) else "failed"),
                    "results": [item for item in results if item["source"] == source],
                }
                for source in ("jira", "testops")
            },
            "kanban": kanban_result,
            "lock_scope": "process_local_single_backend_process_only",
        }
        setting_key = f"release_refresh_result_{release_id}"
        setting = db.get(AppSetting, setting_key)
        if setting is None:
            setting = AppSetting(key=setting_key, value_json={})
            db.add(setting)
        setting.value_json = jsonable_encoder(response)
        db.commit()
        return response
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
        unfinished = [f for f in locals().get("futures", {}) if not f.done()]
        if unfinished:
            def release_after_workers():
                wait(unfinished)
                lock.release()
            threading.Thread(target=release_after_workers, daemon=True).start()
        else:
            lock.release()
