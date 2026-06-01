from datetime import datetime
from typing import List
from urllib.parse import urlparse

import httpx

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..access_policy import AccessPolicy
from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..kanban_member_roles import KanbanProjectMemberRole, effective_role, load_project_role_map
from ..models import (
    Epic,
    EpicAuditLog,
    EpicBlocker,
    EpicComment,
    EpicQA,
    EpicQAStatus,
    EpicStatus,
    EpicTestRun,
    EpicTestStage,
    KanbanEpicComment,
    Ticket,
    TicketStatus,
    User,
    UserRole,
)
from ..realtime import publish_event
from ..schemas import (
    EpicAuditRead,
    EpicBlockerCreate,
    EpicBlockerRead,
    EpicBlockerUpdate,
    EpicCommentCreate,
    EpicCommentRead,
    EpicCreate,
    EpicQACheckStateUpdate,
    EpicQARead,
    EpicQAStatusTransitionRequest,
    EpicQAUpdate,
    EpicPaginationResponse,
    EpicRead,
    EpicTestPlanItem,
    EpicTestRunCreate,
    EpicTestRunRead,
    EpicTestRunUpdate,
    EpicUpdate,
)

router = APIRouter(prefix="/epics", tags=["epics"])
settings = get_settings()

# Epic fields any project member may change (PUT /epics/{id}); ownership/title/notes/status stay coordinator-only.
_EPIC_MEMBER_UPDATE_FIELDS = frozenset({"qa_estimate_hours"})


LEGACY_QA_STATUS_MAP = {
    "draft": EpicQAStatus.DRAFT.value,
    "in_review": EpicQAStatus.IN_TESTING.value,
    "changes_requested": EpicQAStatus.BLOCKED.value,
    "approved": EpicQAStatus.PROD_COMPLETE.value,
}


def _qa_status_key(value: str | None) -> str:
    return str(value or EpicQAStatus.DRAFT.value).strip().lower()


def _db_qa_status(value: str) -> str:
    return value.upper()


def _normalize_qa_for_read(qa: EpicQA | None) -> dict | None:
    if not qa:
        return None

    raw_status = qa.status or EpicQAStatus.DRAFT.value
    normalized_status_key = _qa_status_key(raw_status)
    status = LEGACY_QA_STATUS_MAP.get(normalized_status_key, normalized_status_key)
    if status not in {
        EpicQAStatus.DRAFT.value,
        EpicQAStatus.IN_TESTING.value,
        EpicQAStatus.BLOCKED.value,
        EpicQAStatus.TEST_COMPLETE.value,
        EpicQAStatus.STAGE_COMPLETE.value,
        EpicQAStatus.PROD_COMPLETE.value,
        EpicQAStatus.CLOSED.value,
    }:
        status = EpicQAStatus.DRAFT.value
    active_stage = qa.active_test_stage or EpicTestStage.TEST.value
    if active_stage not in {EpicTestStage.TEST.value, EpicTestStage.STAGE.value, EpicTestStage.PROD.value}:
        active_stage = EpicTestStage.TEST.value

    items = []
    for raw in qa.test_plan_items or []:
        item = dict(raw)
        items.append({
            "id": str(item.get("id") or f"item-{len(items) + 1}"),
            "title": str(item.get("title") or "").strip() or f"Пункт {len(items) + 1}",
            "description_markdown": str(item.get("description_markdown") or item.get("description") or ""),
            "is_checked": bool(item.get("is_checked")),
            "comment": str(item.get("comment") or ""),
        })

    return {
        "id": qa.id,
        "epic_id": qa.epic_id,
        "status": status,
        "active_test_stage": active_stage,
        "test_plan_items": items,
        "test_run_test_url": qa.test_run_test_url,
        "test_run_stage_url": qa.test_run_stage_url,
        "test_run_prod_url": qa.test_run_prod_url,
        "risks": qa.risks,
        "blockers": qa.blockers,
        "known_limitations": qa.known_limitations,
        "verdict": qa.verdict,
        "reviewer_comments": qa.reviewer_comments,
        "last_reviewer_id": qa.last_reviewer_id,
        "updated_at": qa.updated_at,
    }


def _qa_read(qa: EpicQA | None) -> EpicQARead:
    payload = _normalize_qa_for_read(qa)
    if not payload:
        raise HTTPException(status_code=404, detail="Epic QA block not found.")
    return EpicQARead.model_validate(payload)


def _epic_query():
    return select(Epic).options(
        selectinload(Epic.project),
        selectinload(Epic.qa_block),
        selectinload(Epic.history),
        selectinload(Epic.comments),
        selectinload(Epic.blockers).selectinload(EpicBlocker.reporter),
        selectinload(Epic.test_runs),
    )


def _blocker_to_read(blocker: EpicBlocker) -> EpicBlockerRead:
    return EpicBlockerRead(
        id=blocker.id,
        epic_id=blocker.epic_id,
        reporter_id=blocker.reporter_id,
        reporter_username=blocker.reporter.username if blocker.reporter else None,
        body=blocker.body,
        resolved_at=blocker.resolved_at,
        created_at=blocker.created_at,
    )


def _open_questions_count(db: Session, epic_id: int) -> int:
    return db.scalar(
        select(func.count(Ticket.id)).where(
            Ticket.epic_id == epic_id,
            Ticket.status.in_([TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, TicketStatus.RETURNED]),
        )
    ) or 0


def _history_read(db: Session, epic: Epic) -> list[EpicAuditRead]:
    history_reads = []
    for log in epic.history:
        actor = db.get(User, log.user_id) if log.user_id else None
        item = EpicAuditRead.model_validate(log)
        item.username = actor.username if actor else "System"
        history_reads.append(item)
    return history_reads


def _comments_read(db: Session, epic: Epic) -> list[EpicCommentRead]:
    binding = _parse_epic_binding(epic)
    if binding:
        _sync_local_comments_to_kanban(db, epic, binding[0], binding[1])
        return _kanban_comments_read(db, binding[0], binding[1])

    comment_reads = []
    for comment in epic.comments:
        actor = db.get(User, comment.user_id) if comment.user_id else None
        item = EpicCommentRead.model_validate(comment)
        item.username = actor.username if actor else "System"
        comment_reads.append(item)
    return comment_reads


def _kanban_comments_read(db: Session, project_slug: str, kanban_epic_id: int) -> list[EpicCommentRead]:
    comments = db.scalars(
        select(KanbanEpicComment)
        .where(
            KanbanEpicComment.project_slug == project_slug,
            KanbanEpicComment.kanban_epic_id == kanban_epic_id,
        )
        .order_by(KanbanEpicComment.created_at.desc(), KanbanEpicComment.id.desc())
    ).all()
    comment_reads = []
    for comment in comments:
        actor = db.get(User, comment.user_id) if comment.user_id else None
        item = EpicCommentRead.model_validate(comment)
        item.project_slug = project_slug
        item.kanban_epic_id = kanban_epic_id
        item.username = actor.username if actor else "System"
        comment_reads.append(item)
    return comment_reads


def _parse_epic_binding(epic: Epic) -> tuple[str, int] | None:
    if not epic.kanban_url:
        return None
    try:
        return _parse_kanban_reference(epic.kanban_url)
    except HTTPException:
        return None


def _sync_local_comments_to_kanban(db: Session, epic: Epic, project_slug: str, kanban_epic_id: int) -> None:
    existing = db.scalars(
        select(KanbanEpicComment).where(
            KanbanEpicComment.project_slug == project_slug,
            KanbanEpicComment.kanban_epic_id == kanban_epic_id,
        )
    ).all()
    existing_keys = {
        (comment.user_id, comment.body.strip(), comment.created_at.replace(microsecond=0))
        for comment in existing
    }
    changed = False
    for comment in epic.comments:
        comment_key = (comment.user_id, comment.body.strip(), comment.created_at.replace(microsecond=0))
        if comment_key in existing_keys:
            continue
        db.add(KanbanEpicComment(
            project_slug=project_slug,
            kanban_epic_id=kanban_epic_id,
            user_id=comment.user_id,
            body=comment.body,
            created_at=comment.created_at,
        ))
        existing_keys.add(comment_key)
        changed = True
    if changed:
        db.flush()


def _epic_read(db: Session, epic: Epic, user: User | None = None) -> EpicRead:
    can_view_management_metrics = True if user is None else AccessPolicy.can_manage_epic(user, epic)
    payload = {
        "id": epic.id,
        "project_id": epic.project_id,
        "project_name": epic.project.name if epic.project else None,
        "title": epic.title,
        "status": epic.status.value if hasattr(epic.status, "value") else epic.status,
        "jira_url": epic.jira_url,
        "confluence_url": epic.confluence_url,
        "kanban_url": epic.kanban_url,
        "design_url": epic.design_url,
        "notes": epic.notes,
        "qa_estimate_hours": epic.qa_estimate_hours if can_view_management_metrics else None,
        "qa_member_ids": epic.qa_member_ids or [] if can_view_management_metrics else [],
        "spent_total_hours": epic.spent_total_hours if can_view_management_metrics else None,
        "spent_qa_hours": epic.spent_qa_hours if can_view_management_metrics else None,
        "spent_synced_at": epic.spent_synced_at if can_view_management_metrics else None,
        "spent_sync_error": epic.spent_sync_error if can_view_management_metrics else None,
        "lead_analyst_id": epic.lead_analyst_id,
        "lead_designer_id": epic.lead_designer_id,
        "expert_id": epic.expert_id,
        "start_date": epic.start_date,
        "target_date": epic.target_date,
        "created_at": epic.created_at,
        "updated_at": epic.updated_at,
        "qa_block": _normalize_qa_for_read(epic.qa_block),
    }
    read_obj = EpicRead.model_validate(payload)
    read_obj.project_name = epic.project.name if epic.project else None
    read_obj.comments = _comments_read(db, epic)
    read_obj.history = _history_read(db, epic)
    read_obj.blockers = [_blocker_to_read(b) for b in (epic.blockers or [])]
    read_obj.test_runs = [EpicTestRunRead.model_validate(r) for r in (epic.test_runs or [])]
    read_obj.open_questions_count = _open_questions_count(db, epic.id)
    return read_obj


def _normalize_items(items: list[dict] | list[EpicTestPlanItem]) -> list[dict]:
    normalized = []
    seen_ids = set()
    for raw in items:
        item = raw.model_dump() if isinstance(raw, EpicTestPlanItem) else dict(raw)
        item_id = str(item.get("id", "")).strip()
        title = str(item.get("title", "")).strip()
        if not item_id:
            raise HTTPException(status_code=422, detail="Each test plan item must have an id.")
        if item_id in seen_ids:
            raise HTTPException(status_code=422, detail="Test plan item ids must be unique.")
        if not title:
            raise HTTPException(status_code=422, detail="Test plan item title cannot be empty.")
        seen_ids.add(item_id)
        normalized.append({
            "id": item_id,
            "title": title,
            "description_markdown": str(item.get("description_markdown", "") or ""),
            "is_checked": bool(item.get("is_checked", False)),
            "comment": str(item.get("comment", "") or ""),
        })
    return normalized


def _format_kanban_date(value: str | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt = datetime.strptime(text[:10], "%Y-%m-%d")
            except ValueError:
                return None
    return dt.strftime("%d.%m.%Y")


def _parse_kanban_reference(kanban_url: str) -> tuple[str, int]:
    path_parts = [part for part in urlparse(kanban_url).path.split("/") if part]
    for index, part in enumerate(path_parts):
        if part in {"projects", "project"} and index + 2 < len(path_parts) and path_parts[index + 2].isdigit():
            return path_parts[index + 1], int(path_parts[index + 2])
    numeric_parts = [(index, part) for index, part in enumerate(path_parts) if part.isdigit()]
    if numeric_parts:
        index, value = numeric_parts[-1]
        slug = path_parts[index - 1] if index > 0 else ""
        if slug:
            return slug, int(value)
    raise HTTPException(status_code=400, detail="Kanban URL must contain a project slug and epic id.")


def _kanban_get(path: str, token: str, params: list[tuple[str, str]] | None = None) -> dict | list:
    if not token:
        raise HTTPException(status_code=503, detail="Kanban API token is not configured.")
    base_url = settings.kanban_api_base_url.rstrip("/")
    with httpx.Client(
        timeout=settings.kanban_timeout_seconds,
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        response = client.get(f"{base_url}{path}", params=params)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Kanban API request failed with status {response.status_code}.")
    return response.json()


def _kanban_data(payload: dict | list) -> dict | list:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _qa_minutes_from_tasks_worklogs(tasks: list, token: str, project_slug: str, db: Session) -> int:
    """Сумма минут worklog по участникам с ролью QA в настройках Kanban-проекта (Resonance)."""
    role_map = load_project_role_map(db, project_slug)
    total = 0
    for task in tasks:
        if not isinstance(task, dict):
            continue
        tid = int(task.get("id") or 0)
        if tid <= 0:
            continue
        payload = _kanban_get(f"/task/{tid}/work", token=token)
        work_logs = _kanban_data(payload)
        if not isinstance(work_logs, list):
            continue
        for entry in work_logs:
            if not isinstance(entry, dict):
                continue
            person = entry.get("user") if isinstance(entry.get("user"), dict) else {}
            kid = int(person.get("id") or 0) or None
            if effective_role(role_map, kid) != KanbanProjectMemberRole.QA:
                continue
            total += int(entry.get("time") or 0)
    return total


def _kanban_project_task_list(project_slug: str, kanban_epic_id: int, token: str) -> list[dict]:
    page = 1
    tasks: list[dict] = []
    while True:
        payload = _kanban_get(
            f"/project/{project_slug}/list",
            token=token,
            params=[
                (f"filter[epic_id][{kanban_epic_id}]", str(kanban_epic_id)),
                ("count", "100"),
                ("page", str(page)),
            ],
        )
        batch = _kanban_data(payload)
        if not isinstance(batch, list) or not batch:
            break
        tasks.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return tasks


def _sum_task_work_minutes(task_id: int, token: str) -> int:
    payload = _kanban_get(f"/task/{task_id}/work", token=token)
    work_logs = _kanban_data(payload)
    if not isinstance(work_logs, list):
        return 0
    return sum(int(entry.get("time") or 0) for entry in work_logs if isinstance(entry, dict))


def _sync_epic_spent_metrics(epic: Epic, token: str, db: Session) -> tuple[float | None, float | None, str | None]:
    if not epic.kanban_url:
        raise HTTPException(status_code=400, detail="Kanban URL is required to sync spent time.")

    project_slug, kanban_epic_id = _parse_kanban_reference(epic.kanban_url)
    task_payload = _kanban_data(_kanban_get(f"/task/{kanban_epic_id}", token=token))
    if not isinstance(task_payload, dict):
        raise HTTPException(status_code=502, detail="Unexpected Kanban task payload.")

    tasks = task_payload.get("epic_by")
    if not isinstance(tasks, list):
        tasks = _kanban_project_task_list(project_slug, kanban_epic_id, token)

    total_minutes = 0
    for task in tasks:
        task_id = task.get("id") if isinstance(task, dict) else None
        if task_id is None:
            continue
        total_minutes += _sum_task_work_minutes(int(task_id), token)
    total_hours = round(total_minutes / 60, 2)

    qa_minutes = _qa_minutes_from_tasks_worklogs(tasks, token, project_slug, db)
    qa_hours = round(qa_minutes / 60, 2)
    qa_error: str | None = None

    return total_hours, qa_hours, qa_error


def _stage_label(stage: str) -> str:
    return stage.upper()


def _next_stage(stage: str) -> str | None:
    if stage == EpicTestStage.TEST.value:
        return EpicTestStage.STAGE.value
    if stage == EpicTestStage.STAGE.value:
        return EpicTestStage.PROD.value
    return None


def _completion_status_for_stage(stage: str) -> str:
    if stage == EpicTestStage.TEST.value:
        return EpicQAStatus.TEST_COMPLETE.value
    if stage == EpicTestStage.STAGE.value:
        return EpicQAStatus.STAGE_COMPLETE.value
    if stage == EpicTestStage.PROD.value:
        return EpicQAStatus.PROD_COMPLETE.value
    raise HTTPException(status_code=400, detail="Unknown active test stage.")


def _reset_items(items: list[dict]) -> list[dict]:
    return [
        {
            **item,
            "is_checked": False,
            "comment": "",
        }
        for item in items
    ]


def _all_items_checked(items: list[dict]) -> bool:
    return bool(items) and all(bool(item.get("is_checked")) for item in items)


def _assert_status_transition(qa: EpicQA, target_status: str) -> tuple[str | None, list[dict] | None]:
    current_status = _qa_status_key(qa.status)
    current_stage = qa.active_test_stage
    current_items = list(qa.test_plan_items or [])

    if target_status == EpicQAStatus.IN_TESTING.value:
        if current_status == EpicQAStatus.DRAFT.value:
            return EpicTestStage.TEST.value, _reset_items(current_items)
        if current_status in (EpicQAStatus.TEST_COMPLETE.value, EpicQAStatus.STAGE_COMPLETE.value):
            next_stage = _next_stage(current_stage)
            if not next_stage:
                raise HTTPException(status_code=400, detail="No next test stage available.")
            return next_stage, _reset_items(current_items)
        if current_status == EpicQAStatus.BLOCKED.value:
            return current_stage, current_items
        raise HTTPException(status_code=400, detail="This epic cannot be moved to in_testing from its current QA status.")

    if target_status == EpicQAStatus.BLOCKED.value:
        if current_status != EpicQAStatus.IN_TESTING.value:
            raise HTTPException(status_code=400, detail="Only an active test cycle can be blocked.")
        return current_stage, current_items

    if target_status in (
        EpicQAStatus.TEST_COMPLETE.value,
        EpicQAStatus.STAGE_COMPLETE.value,
        EpicQAStatus.PROD_COMPLETE.value,
    ):
        if current_status != EpicQAStatus.IN_TESTING.value:
            raise HTTPException(status_code=400, detail="Only an active test cycle can be completed.")
        expected_status = _completion_status_for_stage(current_stage)
        if target_status != expected_status:
            raise HTTPException(status_code=400, detail=f"Current stage {_stage_label(current_stage)} must be completed with status {expected_status}.")
        if not _all_items_checked(current_items):
            raise HTTPException(status_code=400, detail="All test plan checkboxes must be checked before completing the stage.")
        return current_stage, current_items

    if target_status == EpicQAStatus.CLOSED.value:
        if current_status != EpicQAStatus.PROD_COMPLETE.value:
            raise HTTPException(status_code=400, detail="Only a prod-complete epic can be closed.")
        return current_stage, current_items

    raise HTTPException(status_code=400, detail="Unsupported QA status transition.")


@router.get("", response_model=EpicPaginationResponse)
def list_epics(
    project_id: int | None = None,
    status_filter: EpicStatus | None = Query(None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Epic).options(
        selectinload(Epic.project),
        selectinload(Epic.qa_block),
    ).order_by(Epic.updated_at.desc())

    if project_id:
        if not AccessPolicy.has_project_access(user, project_id):
            raise HTTPException(status_code=403, detail="Project access denied")
        stmt = stmt.where(Epic.project_id == project_id)
    else:
        allowed_ids = AccessPolicy.get_allowed_project_ids(user)
        if allowed_ids:
            stmt = stmt.where(Epic.project_id.in_(allowed_ids))

    if status_filter:
        stmt = stmt.where(Epic.status == status_filter)

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    epics = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).unique().all()
    return EpicPaginationResponse(
        items=[_epic_read(db, epic, user) for epic in epics],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{epic_id}", response_model=EpicRead)
def get_epic(
    epic_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied to this epic")
    return _epic_read(db, epic, user)


@router.post("", response_model=EpicRead, status_code=http_status.HTTP_201_CREATED)
def create_epic(
    payload: EpicCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not AccessPolicy.has_project_access(user, payload.project_id):
        raise HTTPException(status_code=403, detail="Cannot create epic for this project")
    if user.role != UserRole.ADMIN and not AccessPolicy.can_manage_epic(user, Epic(project_id=payload.project_id)):
        raise HTTPException(status_code=403, detail="Only coordinators and admins can create epics")

    epic_data = payload.model_dump()
    if "status" in epic_data and epic_data["status"] is not None:
        raw_status = epic_data["status"]
        epic_data["status"] = EpicStatus(getattr(raw_status, "value", raw_status))
    new_epic = Epic(**epic_data)
    db.add(new_epic)
    db.flush()

    qa = EpicQA(
        epic_id=new_epic.id,
        created_by_id=user.id,
        status=_db_qa_status(EpicQAStatus.DRAFT.value),
        active_test_stage=EpicTestStage.TEST.value,
        test_plan_items=[],
    )
    db.add(qa)
    db.add(EpicAuditLog(
        epic_id=new_epic.id,
        user_id=user.id,
        action="created",
        new_status=new_epic.status.value,
    ))

    db.commit()
    db.refresh(new_epic)
    refreshed = db.scalar(_epic_query().where(Epic.id == new_epic.id))
    return _epic_read(db, refreshed, user)


@router.put("/{epic_id}", response_model=EpicRead)
def update_epic(
    epic_id: int,
    payload: EpicUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied to this epic")

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _epic_read(db, epic, user)

    changed_fields = set(update_data.keys())
    member_fields = changed_fields & _EPIC_MEMBER_UPDATE_FIELDS
    restricted_fields = changed_fields - _EPIC_MEMBER_UPDATE_FIELDS
    if restricted_fields and not AccessPolicy.can_edit_epic_links(user, epic):
        raise HTTPException(
            status_code=403,
            detail="Only coordinators/admins can edit epic title, notes, links, ownership, and status.",
        )
    if member_fields and not AccessPolicy.has_project_access(user, epic.project_id):
        raise HTTPException(status_code=403, detail="Access denied to this epic")

    old_status = epic.status.value if epic.status else None
    old_binding = _parse_epic_binding(epic)
    for field, value in update_data.items():
        if field == "status" and value is not None:
            value = EpicStatus(getattr(value, "value", value))
        setattr(epic, field, value)

    new_binding = _parse_epic_binding(epic)
    if new_binding:
        _sync_local_comments_to_kanban(db, epic, new_binding[0], new_binding[1])

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="epic_updated",
        old_status=old_status if "status" in changed_fields else None,
        new_status=epic.status.value if "status" in changed_fields else None,
        comment="Updated epic fields",
        details_json={"fields": sorted(changed_fields), "kanban_binding_changed": old_binding != new_binding},
    ))

    db.commit()
    refreshed = db.scalar(_epic_query().where(Epic.id == epic_id))
    return _epic_read(db, refreshed, user)


@router.delete("/{epic_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_epic(
    epic_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    epic = db.get(Epic, epic_id)
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    publish_event([], "epic.deleted", {"epic_id": epic_id, "project_id": epic.project_id})
    db.delete(epic)
    db.commit()


@router.post("/{epic_id}/comments", response_model=EpicCommentRead, status_code=http_status.HTTP_201_CREATED)
def add_epic_comment(
    epic_id: int,
    payload: EpicCommentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_edit_epic_notes(user, epic):
        raise HTTPException(status_code=403, detail="You do not have permission to comment on this epic.")

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Comment body cannot be empty.")

    binding = _parse_epic_binding(epic)
    if binding:
        comment = KanbanEpicComment(
            project_slug=binding[0],
            kanban_epic_id=binding[1],
            user_id=user.id,
            body=body,
        )
        db.add(comment)
    else:
        comment = EpicComment(
            epic_id=epic.id,
            user_id=user.id,
            body=body,
        )
        db.add(comment)
    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="comment_added",
        comment=body[:200],
    ))
    db.commit()
    db.refresh(comment)
    item = EpicCommentRead.model_validate(comment)
    if binding:
        item.project_slug = binding[0]
        item.kanban_epic_id = binding[1]
    item.username = user.username
    return item


@router.post("/{epic_id}/spent-time/sync", response_model=EpicRead)
def sync_epic_spent_time(
    epic_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_manage_epic(user, epic):
        raise HTTPException(status_code=403, detail="Only coordinators/admins can sync spent time.")

    kanban_token = user.kanban_token or settings.kanban_api_token
    total_hours, qa_hours, qa_error = _sync_epic_spent_metrics(epic, kanban_token, db)
    epic.spent_total_hours = total_hours
    epic.spent_qa_hours = qa_hours
    epic.spent_synced_at = datetime.utcnow()
    epic.spent_sync_error = qa_error

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="spent_time_synced",
        comment=qa_error or "Spent time synced from Kanban.",
        details_json={
            "spent_total_hours": total_hours,
            "spent_qa_hours": qa_hours,
        },
    ))

    db.commit()
    refreshed = db.scalar(_epic_query().where(Epic.id == epic_id))
    return _epic_read(db, refreshed, user)


@router.put("/{epic_id}/qa", response_model=EpicQARead)
def update_epic_qa(
    epic_id: int,
    payload: EpicQAUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied to this epic")

    qa = epic.qa_block
    update_data = payload.model_dump(exclude_unset=True)

    if "test_plan_items" in update_data:
        if not AccessPolicy.can_edit_test_plan(user, epic):
            raise HTTPException(
                status_code=403,
                detail="QA checklist can only be edited during test plan preparation.",
            )
        qa.test_plan_items = _normalize_items(update_data.pop("test_plan_items"))

    remaining_fields = set(update_data.keys())
    if remaining_fields and not AccessPolicy.has_project_access(user, epic.project_id):
        raise HTTPException(status_code=403, detail="Access denied to this epic")
    if remaining_fields.intersection({"test_run_test_url", "test_run_stage_url", "test_run_prod_url"}):
        if not AccessPolicy.can_edit_epic_links(user, epic):
            raise HTTPException(status_code=403, detail="Only coordinators/admins can edit test run links.")

    for field, value in update_data.items():
        setattr(qa, field, value)

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="qa_updated",
        old_status=_qa_status_key(qa.status),
        new_status=_qa_status_key(qa.status),
        comment="Updated QA details",
        details_json={"fields": ["test_plan_items", *sorted(remaining_fields)] if "test_plan_items" in payload.model_fields_set else sorted(remaining_fields)},
    ))

    db.commit()
    db.refresh(qa)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "qa"})
    return _qa_read(qa)


@router.post("/{epic_id}/qa/check-item", response_model=EpicQARead)
def update_test_plan_item_state(
    epic_id: int,
    payload: EpicQACheckStateUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_update_test_execution(user, epic):
        raise HTTPException(
            status_code=403,
            detail="Checklist progress can only be updated while testing or blocked.",
        )

    items = [dict(item) for item in (epic.qa_block.test_plan_items or [])]
    for index, item in enumerate(items):
        if item.get("id") == payload.item_id:
            updated_item = {
                **item,
                "is_checked": payload.is_checked,
            }
            if payload.comment is not None:
                updated_item["comment"] = payload.comment
            items[index] = updated_item
            epic.qa_block.test_plan_items = items
            db.commit()
            db.refresh(epic.qa_block)
            return _qa_read(epic.qa_block)

    raise HTTPException(status_code=404, detail="Test plan item not found.")


@router.post("/{epic_id}/qa/status", response_model=EpicQARead)
@router.post("/{epic_id}/qa/transition", response_model=EpicQARead)
def transition_qa_status(
    epic_id: int,
    payload: EpicQAStatusTransitionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_transition_qa_status(user, epic):
        raise HTTPException(status_code=403, detail="Only admins and coordinators can change QA status.")

    qa = epic.qa_block
    old_status = _qa_status_key(qa.status)
    old_stage = qa.active_test_stage
    old_items = list(qa.test_plan_items or [])

    next_stage, next_items = _assert_status_transition(qa, payload.target_status.value)

    qa.status = _db_qa_status(payload.target_status.value)
    qa.active_test_stage = next_stage or qa.active_test_stage
    if next_items is not None:
        qa.test_plan_items = next_items
    qa.last_reviewer_id = user.id

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="qa_status_changed",
        old_status=old_status,
        new_status=_qa_status_key(qa.status),
        comment=payload.comment,
        details_json={
            "old_stage": old_stage,
            "new_stage": qa.active_test_stage,
            "completed_count": sum(1 for item in old_items if item.get("is_checked")),
            "total_count": len(old_items),
            "test_plan_snapshot": old_items,
        },
    ))

    db.commit()
    db.refresh(qa)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "qa_status"})
    return _qa_read(qa)


# --- History / blockers / test runs ---


@router.get("/{epic_id}/history", response_model=list[EpicAuditRead])
def list_epic_history(
    epic_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied to this epic")
    return _history_read(db, epic)


@router.get("/{epic_id}/blockers", response_model=list[EpicBlockerRead])
def list_epic_blockers(
    epic_id: int,
    include_resolved: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied to this epic")
    blockers = epic.blockers or []
    if not include_resolved:
        blockers = [b for b in blockers if b.resolved_at is None]
    return [_blocker_to_read(b) for b in blockers]


@router.post(
    "/{epic_id}/blockers",
    response_model=EpicBlockerRead,
    status_code=http_status.HTTP_201_CREATED,
)
def create_epic_blocker(
    epic_id: int,
    payload: EpicBlockerCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_edit_epic_notes(user, epic):
        raise HTTPException(status_code=403, detail="No permission to add blockers")

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Blocker body cannot be empty")

    blocker = EpicBlocker(epic_id=epic.id, reporter_id=user.id, body=body)
    db.add(blocker)
    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="blocker_added",
        comment=body[:200],
    ))
    db.commit()
    db.refresh(blocker)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "blocker_added"})
    return _blocker_to_read(blocker)


@router.patch("/{epic_id}/blockers/{blocker_id}", response_model=EpicBlockerRead)
def update_epic_blocker(
    epic_id: int,
    blocker_id: int,
    payload: EpicBlockerUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_edit_epic_notes(user, epic):
        raise HTTPException(status_code=403, detail="No permission")

    blocker = db.get(EpicBlocker, blocker_id)
    if not blocker or blocker.epic_id != epic.id:
        raise HTTPException(status_code=404, detail="Blocker not found")

    if payload.body is not None:
        blocker.body = payload.body.strip()
    if payload.resolved is not None:
        blocker.resolved_at = datetime.utcnow() if payload.resolved else None

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="blocker_resolved" if payload.resolved else "blocker_updated",
        details_json={"blocker_id": blocker.id},
    ))
    db.commit()
    db.refresh(blocker)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "blocker_updated"})
    return _blocker_to_read(blocker)


@router.delete("/{epic_id}/blockers/{blocker_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_epic_blocker(
    epic_id: int,
    blocker_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_edit_epic_notes(user, epic):
        raise HTTPException(status_code=403, detail="No permission")

    blocker = db.get(EpicBlocker, blocker_id)
    if not blocker or blocker.epic_id != epic.id:
        raise HTTPException(status_code=404, detail="Blocker not found")

    db.delete(blocker)
    db.commit()
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "blocker_deleted"})


@router.get("/{epic_id}/test-runs", response_model=list[EpicTestRunRead])
def list_test_runs(
    epic_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_view_epic(user, epic):
        raise HTTPException(status_code=403, detail="Access denied")
    return [EpicTestRunRead.model_validate(r) for r in (epic.test_runs or [])]


@router.post(
    "/{epic_id}/test-runs",
    response_model=EpicTestRunRead,
    status_code=http_status.HTTP_201_CREATED,
)
def create_test_run(
    epic_id: int,
    payload: EpicTestRunCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_manage_epic(user, epic):
        raise HTTPException(status_code=403, detail="Only coordinators/admins can add test runs")
    if any(run.environment == payload.environment.value for run in (epic.test_runs or [])):
        raise HTTPException(status_code=409, detail="Only one test run is allowed per environment")

    run = EpicTestRun(
        epic_id=epic.id,
        environment=payload.environment.value,
        status=payload.status.value,
        url=payload.url.strip(),
    )
    db.add(run)
    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="test_run_added",
        details_json={"environment": payload.environment.value, "status": payload.status.value},
    ))
    db.commit()
    db.refresh(run)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "test_run_added"})
    return EpicTestRunRead.model_validate(run)


@router.patch("/{epic_id}/test-runs/{run_id}", response_model=EpicTestRunRead)
def update_test_run(
    epic_id: int,
    run_id: int,
    payload: EpicTestRunUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_manage_epic(user, epic):
        raise HTTPException(status_code=403, detail="Only coordinators/admins can update test runs")

    run = db.get(EpicTestRun, run_id)
    if not run or run.epic_id != epic.id:
        raise HTTPException(status_code=404, detail="Test run not found")

    if payload.status is not None:
        run.status = payload.status.value
    if payload.url is not None:
        run.url = payload.url
    if payload.started_at is not None:
        run.started_at = payload.started_at
    if payload.finished_at is not None:
        run.finished_at = payload.finished_at

    db.add(EpicAuditLog(
        epic_id=epic.id,
        user_id=user.id,
        action="test_run_updated",
        details_json={"run_id": run.id},
    ))
    db.commit()
    db.refresh(run)
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "test_run_updated"})
    return EpicTestRunRead.model_validate(run)


@router.delete("/{epic_id}/test-runs/{run_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_test_run(
    epic_id: int,
    run_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    epic = db.scalar(_epic_query().where(Epic.id == epic_id))
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not AccessPolicy.can_manage_epic(user, epic):
        raise HTTPException(status_code=403, detail="Only coordinators/admins can delete test runs")

    run = db.get(EpicTestRun, run_id)
    if not run or run.epic_id != epic.id:
        raise HTTPException(status_code=404, detail="Test run not found")

    db.delete(run)
    db.commit()
    publish_event([], "epic.updated", {"epic_id": epic.id, "kind": "test_run_deleted"})
