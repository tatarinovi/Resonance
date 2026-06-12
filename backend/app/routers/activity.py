"""Unified activity feed endpoint and dashboard role summary."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..access_policy import AccessPolicy
from ..database import get_db
from ..deps import get_current_user
from ..access_policy import is_coordinator_role
from ..expert_utils import user_is_ticket_expert
from ..models import (
    Epic,
    EpicAuditLog,
    EpicBlocker,
    EpicComment,
    Ticket,
    TicketEvent,
    TicketMessage,
    TicketStatus,
    User,
    UserRole,
)
from ..schemas import (
    ActivityEventRead,
    ActivityPaginationResponse,
    EpicRead,
    RoleSummaryResponse,
    RoleSummaryWidget,
    TicketRead,
)
from .dashboard import _ticket_query, _ticket_to_read
from .epics import _epic_read, _epic_query


router = APIRouter(tags=["activity"])


TICKET_STATUS_LABELS = {
    "pending_approval": "На проверке",
    "forwarded": "У эксперта",
    "returned": "На уточнении",
    "answered": "Ожидает автора",
    "closed": "Закрыт",
    "cancelled": "Отменён",
}

QA_STATUS_LABELS = {
    "draft": "Подготовка тест-плана",
    "in_testing": "В тестировании",
    "blocked": "Заблокировано",
    "test_complete": "TEST complete",
    "stage_complete": "STAGE complete",
    "prod_complete": "PROD complete",
    "closed": "Закрыто",
}


def _ticket_event_to_activity(event: TicketEvent, ticket: Ticket) -> ActivityEventRead:
    new_status = TICKET_STATUS_LABELS.get(event.new_value or "", event.new_value or "")
    action_label_map = {
        "created": "создал вопрос",
        "status_changed": f"изменил статус → {new_status}",
        "assignee_changed": "назначил исполнителя",
        "priority_changed": "изменил приоритет",
        "description_changed": "изменил описание",
        "message_added": "добавил сообщение в",
        "attachment_added": "добавил вложение в",
    }
    return ActivityEventRead(
        id=f"te-{event.id}",
        type="status" if event.kind == "status_changed" else ("comment" if event.kind == "message_added" else "question"),
        user_id=event.actor_id,
        username=event.actor.username if event.actor else None,
        action=action_label_map.get(event.kind, event.kind),
        target_id=event.ticket_id,
        target_type="question",
        target_title=ticket.title or (ticket.data_json or {}).get("title") or f"Вопрос #{ticket.id}",
        project_id=ticket.project_id,
        date=event.created_at,
    )


def _epic_audit_to_activity(audit: EpicAuditLog, epic: Epic, username: str | None) -> ActivityEventRead:
    new_status = QA_STATUS_LABELS.get(audit.new_status or "", audit.new_status or "")
    label_map = {
        "created": "создал эпик",
        "epic_updated": "обновил эпик",
        "qa_status_changed": f"изменил QA-статус → {new_status}",
        "qa_updated": "обновил QA-блок",
        "comment_added": "добавил комментарий в",
        "blocker_added": "добавил блокер в",
        "blocker_resolved": "снял блокер с",
        "blocker_updated": "обновил блокер в",
        "test_run_added": "добавил тест-ран в",
        "test_run_updated": "обновил тест-ран в",
        "spent_time_synced": "синхронизировал часы по",
    }
    activity_type = "epic"
    if audit.action.startswith("blocker"):
        activity_type = "blocker"
    elif audit.action.startswith("comment"):
        activity_type = "comment"
    elif audit.action.endswith("status_changed"):
        activity_type = "status"

    return ActivityEventRead(
        id=f"al-{audit.id}",
        type=activity_type,
        user_id=audit.user_id,
        username=username,
        action=label_map.get(audit.action, audit.action),
        target_id=epic.id,
        target_type="epic",
        target_title=epic.title,
        project_id=epic.project_id,
        date=audit.created_at,
    )


@router.get("/activity", response_model=ActivityPaginationResponse)
def list_activity(
    since: datetime | None = None,
    limit: int | None = Query(default=None, ge=1, le=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    target_type: str | None = None,
    activity_type: str | None = None,
    project_id: int | None = None,
    user_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActivityPaginationResponse:
    cutoff = since or (datetime.utcnow() - timedelta(days=14))
    allowed_project_ids = [p.id for p in user.projects] if user.role != UserRole.ADMIN else None
    effective_page_size = min(limit, 100) if limit is not None else page_size

    events: list[ActivityEventRead] = []

    if target_type in (None, "question"):
        ticket_event_stmt = (
            select(TicketEvent)
            .options(selectinload(TicketEvent.actor), selectinload(TicketEvent.ticket))
            .where(TicketEvent.created_at >= cutoff)
            .order_by(TicketEvent.created_at.desc())
        )
        for event in db.scalars(ticket_event_stmt).all():
            ticket = event.ticket
            if not ticket:
                continue
            if allowed_project_ids is not None and ticket.project_id not in allowed_project_ids:
                continue
            if project_id is not None and ticket.project_id != project_id:
                continue
            item = _ticket_event_to_activity(event, ticket)
            if activity_type is not None and item.type != activity_type:
                continue
            if user_id is not None and item.user_id != user_id:
                continue
            events.append(item)

    if target_type in (None, "epic"):
        audit_stmt = (
            select(EpicAuditLog)
            .where(EpicAuditLog.created_at >= cutoff)
            .order_by(EpicAuditLog.created_at.desc())
        )
        for audit in db.scalars(audit_stmt).all():
            epic = db.get(Epic, audit.epic_id)
            if not epic:
                continue
            if allowed_project_ids is not None and epic.project_id not in allowed_project_ids:
                continue
            if project_id is not None and epic.project_id != project_id:
                continue
            actor = db.get(User, audit.user_id) if audit.user_id else None
            item = _epic_audit_to_activity(audit, epic, actor.username if actor else None)
            if activity_type is not None and item.type != activity_type:
                continue
            if user_id is not None and item.user_id != user_id:
                continue
            events.append(item)

    events.sort(key=lambda e: e.date, reverse=True)
    total = len(events)
    start = (page - 1) * effective_page_size
    return ActivityPaginationResponse(
        items=events[start:start + effective_page_size],
        total=total,
        page=page,
        page_size=effective_page_size,
    )


@router.get("/dashboard/role-summary", response_model=RoleSummaryResponse)
def role_summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoleSummaryResponse:
    allowed_project_ids = [p.id for p in user.projects] if user.role != UserRole.ADMIN else None

    ticket_stmt = _ticket_query()
    if allowed_project_ids is not None:
        ticket_stmt = ticket_stmt.where(Ticket.project_id.in_(allowed_project_ids))
    open_statuses = {TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, TicketStatus.RETURNED}
    tickets = list(db.scalars(ticket_stmt.where(Ticket.status.in_(open_statuses))).unique().all())

    epic_stmt = _epic_query()
    if allowed_project_ids is not None:
        epic_stmt = epic_stmt.where(Epic.project_id.in_(allowed_project_ids))
    epics = list(db.scalars(epic_stmt).unique().all())

    now = datetime.utcnow()
    overdue_tickets = [t for t in tickets if t.due_at and t.due_at < now]
    blocked_epics = [e for e in epics if any(b.resolved_at is None for b in (e.blockers or []))]

    my_questions = [t for t in tickets if t.assignee_id == user.id or t.author_id == user.id]
    my_epics = [
        e
        for e in epics
        if user.id in {e.lead_analyst_id, e.lead_designer_id, e.expert_id}
        or user.id in (e.qa_member_ids or [])
    ]

    widgets: list[RoleSummaryWidget] = [
        RoleSummaryWidget(id="open_tickets", title="Открытых вопросов", value=len(tickets)),
        RoleSummaryWidget(id="overdue_tickets", title="С нарушением SLA", value=len(overdue_tickets), description="Просроченные вопросы"),
        RoleSummaryWidget(id="active_epics", title="Активные эпики", value=sum(1 for e in epics if e.status.value != "released")),
        RoleSummaryWidget(id="blocked_epics", title="Заблокированных эпиков", value=len(blocked_epics)),
    ]

    if user.role == UserRole.ADMIN or is_coordinator_role(user):
        widgets.append(RoleSummaryWidget(id="forwarded", title="У эксперта", value=sum(1 for t in tickets if t.status == TicketStatus.FORWARDED)))

    if user_is_ticket_expert(user):
        widgets.append(RoleSummaryWidget(id="assigned_to_me", title="Назначены мне", value=sum(1 for t in tickets if t.assignee_id == user.id)))

    return RoleSummaryResponse(
        role=user.role,
        widgets=widgets,
        overdue_questions=[_ticket_to_read(t) for t in overdue_tickets[:8]],
        blocked_epics=[_epic_read(db, e, user) for e in blocked_epics[:6]],
        my_questions=[_ticket_to_read(t) for t in my_questions[:8]],
        my_epics=[_epic_read(db, e, user) for e in my_epics[:6]],
    )
