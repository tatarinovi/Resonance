import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy import String, asc, case, cast, desc, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..datetime_util import utc_iso_z
from ..deps import get_current_user
from ..access_policy import is_coordinator_role
from ..directions import direction_alias_values, normalize_direction
from ..expert_utils import (
    EXPERT_DIRECTIONS,
    assignee_candidate_for_cross_direction_pool,
    domain_expert_conditions,
    suggested_target_direction_for_assignee,
    user_is_ticket_expert,
    user_may_claim_forwarded_ticket,
)
from ..models import (
    Epic,
    Project,
    Ticket,
    TicketAttachment,
    TicketEvent,
    TicketEventKind,
    TicketMessage,
    TicketMessageKind,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
    user_projects,
)
from ..notification_service import notification_service
from ..operation_context_service import ensure_operation_context
from ..question_ticket_routing import (
    assert_epic_belongs_to_project,
    initial_status_for_new_question,
    is_expert_track_ticket,
    validation_team_for_new_question,
    validate_audience_for_author,
)
from ..realtime import publish_event
from ..schemas import (
    AttachmentCreate,
    AttachmentRead,
    DashboardSummary,
    ExpertReassignBody,
    MentionUserRead,
    MessageCreate,
    MessageRead,
    ProjectRead,
    TicketCreate,
    TicketEventRead,
    TicketPaginationResponse,
    TicketRead,
    TicketUpdate,
    UserDirectoryEntry,
)
from ..ticket_assignee import compute_assignee_for_status
from ..ticket_subscribers import (
    ensure_ticket_subscriber,
    is_user_subscribed,
    list_subscriber_user_ids,
    remove_ticket_subscriber,
)


router = APIRouter(tags=["dashboard"])
logger = logging.getLogger(__name__)


PRIORITY_DEFAULT_SLA = {
    TicketPriority.CRITICAL.value: 4,
    TicketPriority.HIGH.value: 24,
    TicketPriority.MEDIUM.value: 48,
    TicketPriority.LOW.value: 120,
}


def _empty_ticket_page(page: int, page_size: int) -> dict:
    return {"items": [], "total": 0, "page": page, "page_size": page_size}


def _actor_can_reassign_expert(actor: User, ticket: Ticket) -> bool:
    if actor.role == UserRole.ADMIN:
        return True
    if is_coordinator_role(actor):
        return True
    return ticket.assignee_id is not None and ticket.assignee_id == actor.id


def _normalize_username(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip().lstrip("@").split(":")[0]


def _resolve_user_id_by_name(db: Session, name: str | None) -> int | None:
    cleaned = _normalize_username(name)
    if not cleaned:
        return None
    user = db.scalar(select(User).where(User.username == cleaned))
    return user.id if user else None


def _ticket_author_label(ticket: Ticket) -> str:
    return _normalize_username(
        (ticket.author.username if ticket.author else None) or (ticket.data_json or {}).get("author")
    )


def _latest_ticket_message_body(ticket: Ticket, author_id: int | None = None) -> str:
    messages = ticket.messages or []
    for message in reversed(messages):
        if author_id is not None and message.author_id != author_id:
            continue
        body = (message.body or "").strip()
        if body:
            return body
    if author_id is not None:
        return _latest_ticket_message_body(ticket)
    return ""


def _is_ticket_transition_allowed(
    *,
    user: User,
    author_name: str,
    author_id: int | None = None,
    old_status: TicketStatus,
    new_status: TicketStatus,
    assignee_id: int | None = None,
) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if new_status == old_status:
        return False

    is_author = (author_id is not None and user.id == author_id) or user.username == author_name
    is_coordinator = is_coordinator_role(user)
    can_answer_as_expert = user_is_ticket_expert(user)

    pair = (old_status, new_status)

    if pair in ((TicketStatus.CLOSED, TicketStatus.PENDING_APPROVAL), (TicketStatus.CANCELLED, TicketStatus.PENDING_APPROVAL)):
        return is_coordinator

    if pair == (TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED):
        return is_coordinator
    if pair == (TicketStatus.PENDING_APPROVAL, TicketStatus.RETURNED):
        return is_coordinator
    if pair == (TicketStatus.PENDING_APPROVAL, TicketStatus.CANCELLED):
        return is_author or is_coordinator

    if pair == (TicketStatus.FORWARDED, TicketStatus.ANSWERED):
        if assignee_id is not None and user.id == assignee_id:
            return True
        return can_answer_as_expert or is_coordinator
    if pair == (TicketStatus.FORWARDED, TicketStatus.RETURNED):
        if assignee_id is not None and user.id == assignee_id:
            return True
        return can_answer_as_expert or is_coordinator

    if pair == (TicketStatus.RETURNED, TicketStatus.PENDING_APPROVAL):
        return is_author
    if pair == (TicketStatus.RETURNED, TicketStatus.CANCELLED):
        return is_author or is_coordinator

    if pair == (TicketStatus.ANSWERED, TicketStatus.CLOSED):
        return is_author or is_coordinator
    if pair == (TicketStatus.ANSWERED, TicketStatus.PENDING_APPROVAL):
        return is_author

    return False


def _allowed_ticket_target_statuses(
    *,
    user: User,
    author_name: str,
    author_id: int | None = None,
    old_status: TicketStatus,
    assignee_id: int | None,
) -> list[TicketStatus]:
    result: list[TicketStatus] = []
    for cand in TicketStatus:
        if cand == old_status:
            continue
        if _is_ticket_transition_allowed(
            user=user,
            author_name=author_name,
            author_id=author_id,
            old_status=old_status,
            new_status=cand,
            assignee_id=assignee_id,
        ):
            result.append(cand)
    return result


def _ticket_read_for_viewer(db: Session, ticket: Ticket, viewer: User) -> TicketRead:
    author_name = _ticket_author_label(ticket)
    allowed = _allowed_ticket_target_statuses(
        user=viewer,
        author_name=author_name,
        author_id=ticket.author_id,
        old_status=ticket.status,
        assignee_id=ticket.assignee_id,
    )
    subscribed = is_user_subscribed(db, ticket.id, viewer.id)
    can_claim = user_may_claim_forwarded_ticket(ticket, viewer)
    return _ticket_to_read(
        ticket,
        allowed_target_statuses=allowed,
        is_subscribed=subscribed,
        can_claim_assignee=can_claim,
    )


_TICKET_DATA_CLIENT_WRITABLE_KEYS = frozenset()


def _merge_ticket_data_json(ticket: Ticket, incoming: dict[str, Any]) -> None:
    if not incoming:
        return
    merged = (ticket.data_json or {}).copy()
    for k, v in incoming.items():
        if k not in _TICKET_DATA_CLIENT_WRITABLE_KEYS:
            continue
        merged[k] = v
    ticket.data_json = merged
    flag_modified(ticket, "data_json")


def _sync_ticket_assignee_from_matrix(
    db: Session,
    ticket: Ticket,
    *,
    actor_id: int | None,
    log_events: bool,
) -> None:
    desired = compute_assignee_for_status(db, ticket, ticket.status)
    old = ticket.assignee_id
    if desired == old:
        return
    ticket.assignee_id = desired
    if log_events and actor_id is not None:
        db.add(
            TicketEvent(
                ticket_id=ticket.id,
                actor_id=actor_id,
                kind=TicketEventKind.ASSIGNEE_CHANGED.value,
                old_value=str(old) if old is not None else None,
                new_value=str(desired) if desired is not None else None,
            )
        )
    if desired is not None:
        ensure_ticket_subscriber(db, ticket.id, desired)


def _ticket_stream_recipient_ids(db: Session, ticket: Ticket) -> list[int]:
    ids: set[int] = set()
    if ticket.author_id:
        ids.add(ticket.author_id)
    if ticket.assignee_id:
        ids.add(ticket.assignee_id)
    for uid in list_subscriber_user_ids(db, ticket.id):
        ids.add(uid)
    return list(ids)


def _apply_ticket_visibility(stmt, user: User, allowed_project_ids: list[int]):
    if user.role == UserRole.ADMIN:
        return stmt

    stmt = stmt.where(Ticket.project_id.in_(allowed_project_ids))
    user_direction = normalize_direction(user.direction)
    user_direction_aliases = direction_alias_values(user_direction)
    if is_coordinator_role(user):
        stmt = stmt.where(
            or_(
                Ticket.data_json["is_expert_ticket"].as_boolean() == False,  # noqa: E712
                Ticket.data_json["is_expert_ticket"].is_(None),
                Ticket.data_json["target_direction"].as_string().in_(user_direction_aliases),
                Ticket.data_json["validation_team"].as_string().in_(user_direction_aliases),
            )
        )
    elif user.role == UserRole.EXPERT:
        stmt = stmt.where(Ticket.status.in_([TicketStatus.FORWARDED, TicketStatus.ANSWERED, TicketStatus.CLOSED]))
    elif user.role == UserRole.EMPLOYEE and user_direction in EXPERT_DIRECTIONS:
        stmt = stmt.where(
            Ticket.status.in_([TicketStatus.FORWARDED, TicketStatus.ANSWERED, TicketStatus.CLOSED]),
            Ticket.data_json["target_direction"].as_string().in_(user_direction_aliases),
        )
    elif user.role == UserRole.EMPLOYEE and user_direction in ("qa", "front", "back"):
        d = user_direction
        stmt = stmt.where(
            or_(
                Ticket.data_json["target_direction"].as_string() == d,
                Ticket.data_json["validation_team"].as_string() == d,
                Ticket.data_json["target_direction"].as_string().in_(user_direction_aliases),
                Ticket.data_json["validation_team"].as_string().in_(user_direction_aliases),
                Ticket.author_id == user.id,
            )
        )

    return stmt


def _ticket_query():
    return select(Ticket).options(
        selectinload(Ticket.author),
        selectinload(Ticket.assignee),
        selectinload(Ticket.messages).selectinload(TicketMessage.author),
        selectinload(Ticket.attachments),
        selectinload(Ticket.events).selectinload(TicketEvent.actor),
    )


def _message_to_read(message: TicketMessage) -> MessageRead:
    return MessageRead(
        id=message.id,
        ticket_id=message.ticket_id,
        author_id=message.author_id,
        author_username=message.author.username if message.author else None,
        body=message.body,
        kind=message.kind,
        created_at=message.created_at,
        edited_at=message.edited_at,
    )


def _event_to_read(event: TicketEvent) -> TicketEventRead:
    return TicketEventRead(
        id=event.id,
        ticket_id=event.ticket_id,
        actor_id=event.actor_id,
        actor_username=event.actor.username if event.actor else None,
        kind=event.kind,
        old_value=event.old_value,
        new_value=event.new_value,
        comment=event.comment,
        created_at=event.created_at,
    )


def _ticket_to_read(
    ticket: Ticket,
    *,
    allowed_target_statuses: list[TicketStatus] | None = None,
    is_subscribed: bool = False,
    can_claim_assignee: bool = False,
) -> TicketRead:
    return TicketRead(
        id=ticket.id,
        project_id=ticket.project_id,
        epic_id=ticket.epic_id,
        status=ticket.status,
        title=ticket.title or (ticket.data_json.get("title") if ticket.data_json else None),
        description=ticket.description or (ticket.data_json.get("content") if ticket.data_json else None),
        priority=ticket.priority,
        sla_hours=ticket.sla_hours,
        due_at=ticket.due_at,
        author_id=ticket.author_id,
        author_username=ticket.author.username if ticket.author else None,
        assignee_id=ticket.assignee_id,
        assignee_username=ticket.assignee.username if ticket.assignee else None,
        origin_event_id=ticket.origin_event_id,
        expert_event_id=ticket.expert_event_id,
        data_json=ticket.data_json or {},
        messages=[_message_to_read(m) for m in (ticket.messages or [])],
        attachments=[AttachmentRead.model_validate(a) for a in (ticket.attachments or [])],
        events=[_event_to_read(e) for e in (ticket.events or [])],
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        allowed_target_statuses=allowed_target_statuses,
        is_subscribed=is_subscribed,
        can_claim_assignee=can_claim_assignee,
    )


def _publish_ticket_update(db: Session, ticket: Ticket, action: str = "ticket.updated") -> None:
    payload = {
        "ticket_id": ticket.id,
        "project_id": ticket.project_id,
        "status": ticket.status.value if ticket.status else None,
    }
    publish_event(_ticket_stream_recipient_ids(db, ticket), action, payload)


@router.get("/projects", response_model=list[ProjectRead])
def get_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Project]:
    if user.role == UserRole.ADMIN:
        return list(db.scalars(select(Project).order_by(Project.id)).all())
    return user.projects


@router.get("/directory/users", response_model=list[UserDirectoryEntry])
def list_directory_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[UserDirectoryEntry]:
    """Одобренные пользователи, с которыми есть общий проект (для аватаров и подписей без прав админа)."""
    stmt = select(User).options(selectinload(User.projects)).where(User.is_approved.is_(True))
    if user.role != UserRole.ADMIN:
        allowed = [p.id for p in user.projects]
        if not allowed:
            return []
        member_subq = select(user_projects.c.user_id).where(user_projects.c.project_id.in_(allowed))
        stmt = stmt.where(User.id.in_(member_subq))
    rows = db.scalars(stmt.order_by(User.username)).unique().all()
    return [
        UserDirectoryEntry(
            id=u.id,
            username=u.username,
            role=u.role,
            workspace=u.workspace,
            is_approved=u.is_approved,
            direction=u.direction,
            project_ids=[p.id for p in u.projects],
            last_login_at=u.last_login_at,
        )
        for u in rows
    ]


@router.get("/projects/{project_id}/mention-users", response_model=list[MentionUserRead])
def list_project_mention_users(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MentionUserRead]:
    project = db.scalar(
        select(Project).options(selectinload(Project.users)).where(Project.id == project_id)
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    allowed_ids = {p.id for p in user.projects}
    if user.role != UserRole.ADMIN and project_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Project access denied")

    members = sorted((u for u in project.users if u.is_approved), key=lambda u: u.username.lower())
    return [MentionUserRead.model_validate(u) for u in members]


@router.get("/tickets", response_model=TicketPaginationResponse)
def get_tickets(
    status_filter: TicketStatus | None = Query(default=None, alias="status"),
    priority: TicketPriority | None = None,
    search: str | None = None,
    project_id: int | None = None,
    epic_id: int | None = None,
    epic_name: str | None = None,
    assignee_id: int | None = None,
    author_id: int | None = None,
    sort: str = Query(default="-updated_at"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and not allowed_project_ids:
        return _empty_ticket_page(page, page_size)

    stmt = _apply_ticket_visibility(_ticket_query(), user, allowed_project_ids)

    sort_field = sort.lstrip("-")
    direction = desc if sort.startswith("-") else asc
    priority_sort = case(
        (Ticket.priority == TicketPriority.CRITICAL.value, 0),
        (Ticket.priority == TicketPriority.HIGH.value, 1),
        (Ticket.priority == TicketPriority.MEDIUM.value, 2),
        (Ticket.priority == TicketPriority.LOW.value, 3),
        else_=4,
    )
    sort_column = {
        "updated_at": Ticket.updated_at,
        "created_at": Ticket.created_at,
        "due_at": Ticket.due_at,
        "priority": priority_sort,
        "status": Ticket.status,
        "sla": Ticket.due_at,
    }.get(sort_field, Ticket.updated_at)
    stmt = stmt.order_by(direction(sort_column))

    if project_id is not None:
        if user.role != UserRole.ADMIN and project_id not in allowed_project_ids:
            raise HTTPException(status_code=403, detail="Project access denied")
        stmt = stmt.where(Ticket.project_id == project_id)
    if status_filter is not None:
        stmt = stmt.where(Ticket.status == status_filter)
    if priority is not None:
        stmt = stmt.where(Ticket.priority == priority.value)
    if epic_id is not None:
        stmt = stmt.where(Ticket.epic_id == epic_id)
    if epic_name and epic_name != "all":
        stmt = stmt.where(Ticket.data_json["epic_name"].as_string() == epic_name)
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    if author_id is not None:
        stmt = stmt.where(Ticket.author_id == author_id)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(Ticket.title, "")).like(pattern),
                func.lower(func.coalesce(Ticket.description, "")).like(pattern),
                func.lower(Ticket.data_json["content"].as_string()).like(pattern),
                func.lower(cast(Ticket.data_json["thread"], String)).like(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    items = list(db.scalars(stmt).unique().all())

    return {
        "items": [_ticket_to_read(t) for t in items],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/tickets/all", response_model=list[TicketRead])
def get_all_tickets(
    status_filter: TicketStatus | None = Query(default=None, alias="status"),
    priority: TicketPriority | None = None,
    search: str | None = None,
    project_id: int | None = None,
    epic_id: int | None = None,
    epic_name: str | None = None,
    assignee_id: int | None = None,
    author_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketRead]:
    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and not allowed_project_ids:
        return []

    stmt = _apply_ticket_visibility(_ticket_query(), user, allowed_project_ids).order_by(Ticket.updated_at.desc())

    if project_id is not None:
        if user.role != UserRole.ADMIN and project_id not in allowed_project_ids:
            raise HTTPException(status_code=403, detail="Project access denied")
        stmt = stmt.where(Ticket.project_id == project_id)
    if status_filter is not None:
        stmt = stmt.where(Ticket.status == status_filter)
    if priority is not None:
        stmt = stmt.where(Ticket.priority == priority.value)
    if epic_id is not None:
        stmt = stmt.where(Ticket.epic_id == epic_id)
    if epic_name and epic_name != "all":
        stmt = stmt.where(Ticket.data_json["epic_name"].as_string() == epic_name)
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    if author_id is not None:
        stmt = stmt.where(Ticket.author_id == author_id)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(Ticket.title, "")).like(pattern),
                func.lower(func.coalesce(Ticket.description, "")).like(pattern),
                func.lower(Ticket.data_json["content"].as_string()).like(pattern),
            )
        )

    items = list(db.scalars(stmt).unique().all())
    return [_ticket_to_read(t) for t in items]


@router.get("/tickets/summary", response_model=DashboardSummary)
def get_tickets_summary(
    project_id: int | None = None,
    epic_name: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and not allowed_project_ids:
        return {
            "total_count": 0,
            "status_counts": {},
            "priority_counts": {},
            "direction_counts": {},
            "project_counts": {},
            "source_counts": {},
            "overdue_count": 0,
        }

    stmt = _apply_ticket_visibility(select(Ticket), user, allowed_project_ids)

    if project_id is not None:
        if user.role != UserRole.ADMIN and project_id not in allowed_project_ids:
            raise HTTPException(status_code=403, detail="Project access denied")
        stmt = stmt.where(Ticket.project_id == project_id)
    if epic_name and epic_name != "all":
        stmt = stmt.where(Ticket.data_json["epic_name"].as_string() == epic_name)

    tickets = db.scalars(stmt).all()

    status_counts: dict[str, int] = {}
    priority_counts: dict[str, int] = {}
    direction_counts: dict[str, int] = {}
    project_counts: dict[int, int] = {}
    source_counts: dict[str, int] = {}
    overdue = 0
    now = datetime.utcnow()

    for t in tickets:
        status_counts[t.status.value] = status_counts.get(t.status.value, 0) + 1
        prio = t.priority or "medium"
        priority_counts[prio] = priority_counts.get(prio, 0) + 1

        direction = (t.data_json or {}).get("target_direction") or (t.data_json or {}).get("target_expert") or "unknown"
        direction_counts[direction] = direction_counts.get(direction, 0) + 1

        source = (t.data_json or {}).get("source_direction") or "unknown"
        source_counts[source] = source_counts.get(source, 0) + 1

        project_counts[t.project_id] = project_counts.get(t.project_id, 0) + 1

        if t.due_at and t.due_at < now and t.status not in {TicketStatus.CLOSED, TicketStatus.CANCELLED, TicketStatus.ANSWERED}:
            overdue += 1

    return {
        "total_count": len(tickets),
        "status_counts": status_counts,
        "priority_counts": priority_counts,
        "direction_counts": direction_counts,
        "project_counts": project_counts,
        "source_counts": source_counts,
        "overdue_count": overdue,
    }


@router.get("/tickets/{ticket_id}", response_model=TicketRead)
def get_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and ticket.project_id not in allowed_project_ids:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    visible = db.scalar(
        _apply_ticket_visibility(select(Ticket.id), user, allowed_project_ids).where(Ticket.id == ticket_id)
    )
    if not visible:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    return _ticket_read_for_viewer(db, ticket, user)


@router.get("/tickets/{ticket_id}/reassign-candidates")
def list_reassign_candidates(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    ticket = _get_ticket_if_visible(db, ticket_id, user)
    if ticket.status not in (TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED):
        raise HTTPException(status_code=400, detail="Reassignment only while ticket is pending approval or forwarded")
    if not _actor_can_reassign_expert(user, ticket):
        raise HTTPException(status_code=403, detail="You cannot reassign this ticket")
    stmt = (
        select(User)
        .options(selectinload(User.projects))
        .join(User.projects)
        .where(Project.id == ticket.project_id, User.is_approved.is_(True))
        .order_by(User.username)
    )
    rows = db.scalars(stmt).unique().all()
    out: list[dict[str, Any]] = []
    for u in rows:
        if u.id == ticket.assignee_id:
            continue
        if not assignee_candidate_for_cross_direction_pool(ticket, u):
            continue
        out.append({"id": u.id, "username": u.username, "direction": u.direction})
    return out


@router.get("/tickets/{ticket_id}/allowed-status-transitions", response_model=list[TicketStatus])
def get_ticket_allowed_status_transitions(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketStatus]:
    ticket = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and ticket.project_id not in allowed_project_ids:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    visible = db.scalar(
        _apply_ticket_visibility(select(Ticket.id), user, allowed_project_ids).where(Ticket.id == ticket_id)
    )
    if not visible:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    author_name = _ticket_author_label(ticket)
    return _allowed_ticket_target_statuses(
        user=user, author_name=author_name, author_id=ticket.author_id, old_status=ticket.status, assignee_id=ticket.assignee_id
    )


def _get_ticket_if_visible(db: Session, ticket_id: int, user: User) -> Ticket:
    ticket = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    allowed_project_ids = [project.id for project in user.projects]
    if user.role != UserRole.ADMIN and ticket.project_id not in allowed_project_ids:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")
    visible = db.scalar(
        _apply_ticket_visibility(select(Ticket.id), user, allowed_project_ids).where(Ticket.id == ticket_id)
    )
    if not visible:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")
    return ticket


@router.post("/tickets/{ticket_id}/subscribe", response_model=TicketRead)
def subscribe_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)
    ensure_ticket_subscriber(db, ticket_id, user.id)
    db.commit()
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    out = refreshed or ticket
    _publish_ticket_update(db, out)
    return _ticket_read_for_viewer(db, out, user)


@router.post("/tickets/{ticket_id}/reassign-expert", response_model=TicketRead)
def reassign_ticket_expert(
    ticket_id: int,
    payload: ExpertReassignBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)

    if ticket.status not in (TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Expert reassignment is only allowed while the ticket is pending approval or forwarded",
        )

    if not _actor_can_reassign_expert(user, ticket):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You cannot reassign this ticket to another expert",
        )

    target = db.scalar(
        select(User).options(selectinload(User.projects)).where(User.id == payload.assignee_id)
    )
    if target is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Target user not found")

    if not assignee_candidate_for_cross_direction_pool(ticket, target):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Selected user is not an assignee candidate on this project for this ticket",
        )

    if target.id == ticket.assignee_id:
        return _ticket_read_for_viewer(db, ticket, user)

    old_status = ticket.status
    old_assignee = ticket.assignee_id
    if ticket.status == TicketStatus.PENDING_APPROVAL:
        ticket.status = TicketStatus.FORWARDED
    ticket.assignee_id = target.id
    merged = (ticket.data_json or {}).copy()
    merged["expert_assignee_manual"] = True
    new_td = suggested_target_direction_for_assignee(target)
    if new_td is not None:
        merged["target_direction"] = new_td
    ticket.data_json = merged
    flag_modified(ticket, "data_json")

    db.add(
        TicketEvent(
            ticket_id=ticket.id,
            actor_id=user.id,
            kind=TicketEventKind.ASSIGNEE_CHANGED.value,
            old_value=str(old_assignee) if old_assignee is not None else None,
            new_value=str(target.id),
        )
    )
    if old_status != ticket.status:
        db.add(
            TicketEvent(
                ticket_id=ticket.id,
                actor_id=user.id,
                kind=TicketEventKind.STATUS_CHANGED.value,
                old_value=old_status.value,
                new_value=ticket.status.value,
            )
        )
    ensure_ticket_subscriber(db, ticket.id, target.id)

    db.commit()
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket.id))
    out = refreshed or ticket
    _publish_ticket_update(db, out)
    return _ticket_read_for_viewer(db, out, user)


@router.post("/tickets/{ticket_id}/claim-assignee", response_model=TicketRead)
def claim_ticket_assignee(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)

    if ticket.status != TicketStatus.FORWARDED:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Claiming assignee is only allowed while the ticket is forwarded",
        )

    if not user_may_claim_forwarded_ticket(ticket, user):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You cannot take responsibility for this ticket",
        )

    old_assignee = ticket.assignee_id
    ticket.assignee_id = user.id
    merged = (ticket.data_json or {}).copy()
    merged["expert_assignee_manual"] = True
    new_td = suggested_target_direction_for_assignee(user)
    if new_td is not None:
        merged["target_direction"] = new_td
    ticket.data_json = merged
    flag_modified(ticket, "data_json")

    db.add(
        TicketEvent(
            ticket_id=ticket.id,
            actor_id=user.id,
            kind=TicketEventKind.ASSIGNEE_CHANGED.value,
            old_value=str(old_assignee) if old_assignee is not None else None,
            new_value=str(user.id),
        )
    )
    ensure_ticket_subscriber(db, ticket.id, user.id)

    db.commit()
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket.id))
    out = refreshed or ticket
    _publish_ticket_update(db, out)
    return _ticket_read_for_viewer(db, out, user)


@router.delete("/tickets/{ticket_id}/subscribe", response_model=TicketRead)
def unsubscribe_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)
    remove_ticket_subscriber(db, ticket_id, user.id)
    db.commit()
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    out = refreshed or ticket
    _publish_ticket_update(db, out)
    return _ticket_read_for_viewer(db, out, user)


@router.put("/tickets/{ticket_id}", response_model=TicketRead)
async def update_ticket(
    ticket_id: int,
    payload: TicketUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    ticket = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found in database")

    allowed_project_ids = [p.id for p in user.projects]
    if user.role != UserRole.ADMIN and ticket.project_id not in allowed_project_ids:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    op_ctx = ensure_operation_context(db, actor_id=user.id, command_type="update_ticket")
    op_ctx_id = op_ctx.id if op_ctx else None

    incoming_data = payload.data_json or {}
    clear_reopen = bool(incoming_data.get("clear_reopen_submission"))
    _merge_ticket_data_json(ticket, incoming_data)
    if clear_reopen:
        if ticket.author_id != user.id:
            raise HTTPException(status_code=403, detail="Only the author can clear reopen state")
        merged_clear = (ticket.data_json or {}).copy()
        had = merged_clear.pop("reopened_to_author", None) is not None
        if had:
            ticket.data_json = merged_clear
            flag_modified(ticket, "data_json")

    status_changed = False
    prev_status_value: str | None = None

    # Status transition
    if payload.status and payload.status != ticket.status:
        old_status = ticket.status
        new_status = payload.status
        prev_status_value = old_status.value
        status_changed = True
        author_name = _ticket_author_label(ticket)
        if not _is_ticket_transition_allowed(
            user=user,
            author_name=author_name,
            author_id=ticket.author_id,
            old_status=old_status,
            new_status=new_status,
            assignee_id=ticket.assignee_id,
        ):
            raise HTTPException(
                status_code=403,
                detail=f"Transition '{old_status.value}' -> '{new_status.value}' is not allowed for role '{user.role.value}'",
            )
        ticket.status = new_status
        db.add(
            TicketEvent(
                ticket_id=ticket.id,
                actor_id=user.id,
                kind=TicketEventKind.STATUS_CHANGED.value,
                old_value=old_status.value,
                new_value=new_status.value,
            )
        )
        merged = (ticket.data_json or {}).copy()
        if new_status == TicketStatus.FORWARDED and old_status == TicketStatus.PENDING_APPROVAL:
            merged.pop("expert_assignee_manual", None)
            merged.pop("reopened_to_author", None)
        if new_status == TicketStatus.PENDING_APPROVAL and old_status in (TicketStatus.CLOSED, TicketStatus.CANCELLED):
            merged["reopened_to_author"] = True
        if new_status == TicketStatus.ANSWERED:
            answer_text = incoming_data.get("response") or _latest_ticket_message_body(ticket, user.id)
            if answer_text:
                merged["response"] = answer_text
        history = merged.get("history", [])
        history.append(
            {
                "time": utc_iso_z(datetime.now(timezone.utc)),
                "type": "status_change",
                "author": user.username,
                "old": old_status.value,
                "new": new_status.value,
            }
        )
        merged["history"] = history
        ticket.data_json = merged
        flag_modified(ticket, "data_json")

        ensure_ticket_subscriber(db, ticket.id, user.id)
        _sync_ticket_assignee_from_matrix(db, ticket, actor_id=user.id, log_events=True)

        try:
            if new_status == TicketStatus.FORWARDED:
                await notification_service.notify_expert_forwarded(db, ticket, operation_context_id=op_ctx_id)
            elif new_status == TicketStatus.RETURNED:
                reason = incoming_data.get("return_reason", "Требуется уточнение данных")
                await notification_service.notify_author_returned(db, ticket, reason, operation_context_id=op_ctx_id)
            elif new_status == TicketStatus.ANSWERED:
                ans = (
                    incoming_data.get("response")
                    or _latest_ticket_message_body(ticket, user.id)
                    or (ticket.data_json or {}).get("response")
                    or ""
                )
                await notification_service.notify_author_answered(db, ticket, ans, operation_context_id=op_ctx_id)
            elif new_status == TicketStatus.PENDING_APPROVAL and old_status in (
                TicketStatus.CLOSED,
                TicketStatus.CANCELLED,
            ):
                await notification_service.notify_author_returned(
                    db, ticket, "Вопрос переоткрыт координатором", operation_context_id=op_ctx_id
                )
        except Exception:
            logger.exception("Notification error in update_ticket for ticket %s", ticket.id)

    # Direct field updates (assignee_id from client ignored — matrix owns assignment)
    field_changes: list[tuple[str, Any, Any]] = []
    can_edit_question_content = user.role == UserRole.ADMIN or is_coordinator_role(user) or ticket.author_id == user.id
    if payload.title is not None and payload.title != ticket.title:
        if not can_edit_question_content:
            raise HTTPException(status_code=403, detail="Only author, coordinator, or admin can edit question title")
        field_changes.append(("title", ticket.title, payload.title))
        ticket.title = payload.title
    if payload.description is not None and payload.description != ticket.description:
        if not can_edit_question_content:
            raise HTTPException(status_code=403, detail="Only author, coordinator, or admin can edit question description")
        field_changes.append(("description", ticket.description, payload.description))
        ticket.description = payload.description
    if payload.priority is not None and payload.priority.value != ticket.priority:
        if user.role != UserRole.ADMIN and not is_coordinator_role(user):
            raise HTTPException(status_code=403, detail="Only coordinator or admin can change priority")
        field_changes.append(("priority", ticket.priority, payload.priority.value))
        ticket.priority = payload.priority.value
    if payload.sla_hours is not None and payload.sla_hours != ticket.sla_hours:
        if user.role != UserRole.ADMIN and not is_coordinator_role(user):
            raise HTTPException(status_code=403, detail="Only coordinator or admin can change SLA hours")
        field_changes.append(("sla_hours", ticket.sla_hours, payload.sla_hours))
        ticket.sla_hours = payload.sla_hours
    if payload.due_at is not None and payload.due_at != ticket.due_at:
        if user.role != UserRole.ADMIN and not is_coordinator_role(user):
            raise HTTPException(status_code=403, detail="Only coordinator or admin can change due date")
        field_changes.append(("due_at", ticket.due_at, payload.due_at))
        ticket.due_at = payload.due_at
    if payload.epic_id is not None and payload.epic_id != ticket.epic_id:
        if user.role != UserRole.ADMIN and not is_coordinator_role(user):
            raise HTTPException(status_code=403, detail="Only coordinator or admin can change epic")
        field_changes.append(("epic_id", ticket.epic_id, payload.epic_id))
        ticket.epic_id = payload.epic_id

    for field_name, old_value, new_value in field_changes:
        kind = TicketEventKind.PRIORITY_CHANGED.value if field_name == "priority" else (
            TicketEventKind.DESCRIPTION_CHANGED.value if field_name in {"title", "description"} else "field_changed"
        )
        db.add(
            TicketEvent(
                ticket_id=ticket.id,
                actor_id=user.id,
                kind=kind,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(new_value) if new_value is not None else None,
            )
        )

    _sync_ticket_assignee_from_matrix(db, ticket, actor_id=user.id, log_events=True)

    db.commit()
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket.id))
    ticket_out = refreshed or ticket

    if status_changed and prev_status_value is not None:
        try:
            notification_service.notify_ticket_watchers_status(
                db,
                ticket_id=ticket_out.id,
                actor_id=user.id,
                old_status=prev_status_value,
                new_status=ticket_out.status.value,
                operation_context_id=op_ctx_id,
            )
        except Exception:
            logger.exception("Watcher notification error after status change ticket %s", ticket_out.id)

    _publish_ticket_update(db, ticket_out)
    return _ticket_read_for_viewer(db, ticket_out, user)


@router.delete("/tickets/{ticket_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can delete tickets")

    allowed_project_ids = [p.id for p in user.projects]
    if user.role != UserRole.ADMIN and ticket.project_id not in allowed_project_ids:
        raise HTTPException(status_code=403, detail="Access denied to this ticket")

    db.delete(ticket)
    db.commit()


@router.post("/tickets", response_model=TicketRead, status_code=http_status.HTTP_201_CREATED)
async def create_ticket(
    payload: TicketCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketRead:
    allowed_project_ids = [p.id for p in user.projects]
    if user.role != UserRole.ADMIN and payload.project_id not in allowed_project_ids:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this project",
        )

    op_ctx = ensure_operation_context(db, actor_id=user.id, command_type="create_ticket")
    op_ctx_id = op_ctx.id if op_ctx else None

    priority_value = payload.priority.value if payload.priority else TicketPriority.MEDIUM.value
    sla_hours = payload.sla_hours if payload.sla_hours is not None else PRIORITY_DEFAULT_SLA[priority_value]
    due_at = payload.due_at
    if due_at is None and sla_hours:
        due_at = datetime.utcnow() + timedelta(hours=sla_hours)

    title = (payload.title or "").strip() or "(без заголовка)"
    description = payload.description or ""

    if not payload.epic_id or payload.epic_id < 1:
        raise HTTPException(status_code=422, detail="epic_id is required")
    epic = db.get(Epic, payload.epic_id)
    if epic is None:
        raise HTTPException(status_code=422, detail="Epic not found")
    assert_epic_belongs_to_project(epic, payload.project_id)

    legacy = payload.data_json.copy() if payload.data_json else {}
    td_raw = legacy.get("target_direction")
    audience = validate_audience_for_author(user=user, audience=td_raw if isinstance(td_raw, str) else None)
    initial_status = initial_status_for_new_question(audience=audience, user=user)

    legacy.setdefault("title", title)
    legacy.setdefault("content", description)
    legacy.setdefault("priority", priority_value)
    legacy.setdefault("sla_hours", sla_hours)
    legacy.setdefault("author", user.username)
    source_direction = normalize_direction(user.direction)
    if source_direction:
        legacy.setdefault("source_direction", source_direction)
    legacy["target_direction"] = audience
    legacy["validation_team"] = validation_team_for_new_question(audience=audience, user=user)
    legacy["epic_name"] = epic.title
    legacy["is_expert_ticket"] = is_expert_track_ticket(initial_status=initial_status, audience=audience)
    legacy["history"] = [
        {
            "time": utc_iso_z(datetime.now(timezone.utc)),
            "type": "created",
            "author": user.username,
        }
    ]

    ticket = Ticket(
        project_id=payload.project_id,
        epic_id=payload.epic_id,
        status=initial_status,
        origin_event_id=f"web_manual_{uuid.uuid4()}",
        title=title[:500],
        description=description,
        priority=priority_value,
        sla_hours=sla_hours,
        due_at=due_at,
        author_id=user.id,
        assignee_id=None,
        data_json=legacy,
    )

    db.add(ticket)
    db.flush()
    db.add(
        TicketEvent(
            ticket_id=ticket.id,
            actor_id=user.id,
            kind=TicketEventKind.CREATED.value,
        )
    )
    _sync_ticket_assignee_from_matrix(db, ticket, actor_id=None, log_events=False)
    ensure_ticket_subscriber(db, ticket.id, user.id)
    db.commit()
    db.refresh(ticket)

    try:
        if initial_status == TicketStatus.PENDING_APPROVAL:
            await notification_service.notify_new_ticket(db, ticket, operation_context_id=op_ctx_id)
        elif initial_status == TicketStatus.FORWARDED:
            await notification_service.notify_expert_forwarded(db, ticket, operation_context_id=op_ctx_id)
    except Exception:
        logger.exception("Failed to notify about new ticket %s", ticket.id)
        db.rollback()

    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket.id))
    ticket_out = refreshed if refreshed is not None else ticket
    _publish_ticket_update(db, ticket_out, action="ticket.created")
    return _ticket_read_for_viewer(db, ticket_out, user)


# --- Messages and attachments sub-routes ---


@router.get("/tickets/{ticket_id}/messages", response_model=list[MessageRead])
def list_messages(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MessageRead]:
    ticket = _get_ticket_if_visible(db, ticket_id, user)
    return [_message_to_read(m) for m in ticket.messages]


@router.post(
    "/tickets/{ticket_id}/messages",
    response_model=MessageRead,
    status_code=http_status.HTTP_201_CREATED,
)
async def create_message(
    ticket_id: int,
    payload: MessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)

    op_ctx = ensure_operation_context(db, actor_id=user.id, command_type="create_ticket_message")
    op_ctx_id = op_ctx.id if op_ctx else None

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message body cannot be empty")

    kind = payload.kind if payload.kind in {k.value for k in TicketMessageKind} else TicketMessageKind.MESSAGE.value

    response_status_changed = False
    prev_status_value: str | None = None
    if kind == TicketMessageKind.RESPONSE.value:
        if ticket.status != TicketStatus.FORWARDED:
            raise HTTPException(status_code=400, detail="Only forwarded questions can be answered")
        if not (
            user.role == UserRole.ADMIN
            or is_coordinator_role(user)
            or ticket.assignee_id == user.id
        ):
            raise HTTPException(status_code=403, detail="Only assigned expert, coordinator, or admin can answer")
        prev_status_value = ticket.status.value
        ticket.status = TicketStatus.ANSWERED
        response_status_changed = True

    message = TicketMessage(ticket_id=ticket.id, author_id=user.id, body=body, kind=kind)
    db.add(message)
    db.flush()

    if payload.attachment_ids:
        for att_id in payload.attachment_ids:
            attachment = db.get(TicketAttachment, att_id)
            if attachment and attachment.ticket_id == ticket.id:
                attachment.message_id = message.id

    db.add(
        TicketEvent(
            ticket_id=ticket.id,
            actor_id=user.id,
            kind=TicketEventKind.MESSAGE_ADDED.value,
            payload_json={"message_id": message.id, "kind": kind},
        )
    )

    # Mirror to legacy data_json.thread for backwards compat
    merged = (ticket.data_json or {}).copy()
    thread = merged.get("thread", [])
    thread.append(
        {
            "role": "responder" if kind == TicketMessageKind.RESPONSE.value else "author",
            "author": user.username,
            "text": body,
            "timestamp": utc_iso_z(datetime.now(timezone.utc)),
        }
    )
    merged["thread"] = thread
    if kind == TicketMessageKind.RESPONSE.value:
        merged["response"] = body
    ticket.data_json = merged
    flag_modified(ticket, "data_json")

    ensure_ticket_subscriber(db, ticket.id, user.id)
    if response_status_changed:
        db.add(
            TicketEvent(
                ticket_id=ticket.id,
                actor_id=user.id,
                kind=TicketEventKind.STATUS_CHANGED.value,
                old_value=prev_status_value,
                new_value=TicketStatus.ANSWERED.value,
            )
        )
        _sync_ticket_assignee_from_matrix(db, ticket, actor_id=user.id, log_events=True)

    db.commit()
    db.refresh(message)
    refreshed = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    _publish_ticket_update(db, refreshed, action="ticket.message_added")
    if response_status_changed:
        _publish_ticket_update(db, refreshed, action="ticket.updated")
        try:
            await notification_service.notify_author_answered(
                db,
                ticket,
                response_text=body,
                operation_context_id=op_ctx_id,
            )
        except Exception:
            logger.exception("Answered notification error in create_message for ticket %s", ticket.id)
    try:
        await notification_service.notify_ticket_mentions(
            db,
            ticket_id=ticket.id,
            message_id=message.id,
            author_id=user.id,
            author_username=user.username,
            body=body,
            operation_context_id=op_ctx_id,
        )
    except Exception:
        logger.exception("Notification error in create_message for ticket %s", ticket.id)
    try:
        notification_service.notify_ticket_watchers_message(
            db,
            ticket_id=ticket.id,
            message_id=message.id,
            author_id=user.id,
            author_username=user.username,
            body=body,
            message_kind=kind,
            operation_context_id=op_ctx_id,
        )
    except Exception:
        logger.exception("Watcher notification error in create_message for ticket %s", ticket.id)
    return _message_to_read(message)


@router.get("/tickets/{ticket_id}/attachments", response_model=list[AttachmentRead])
def list_attachments(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketAttachment]:
    ticket = _get_ticket_if_visible(db, ticket_id, user)
    return ticket.attachments


@router.post(
    "/tickets/{ticket_id}/attachments",
    response_model=AttachmentRead,
    status_code=http_status.HTTP_201_CREATED,
)
def create_attachment(
    ticket_id: int,
    payload: AttachmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttachmentRead:
    ticket = _get_ticket_if_visible(db, ticket_id, user)

    if not (payload.url or "").strip():
        raise HTTPException(status_code=422, detail="Attachment URL is required")

    attachment = TicketAttachment(
        ticket_id=ticket.id,
        message_id=payload.message_id,
        uploader_id=user.id,
        name=(payload.name or "attachment")[:255],
        mime_type=(payload.mime_type or "application/octet-stream")[:100],
        size_bytes=int(payload.size_bytes or 0),
        url=payload.url[:1024],
    )
    db.add(attachment)
    db.add(
        TicketEvent(
            ticket_id=ticket.id,
            actor_id=user.id,
            kind=TicketEventKind.ATTACHMENT_ADDED.value,
            payload_json={"name": attachment.name},
        )
    )
    db.commit()
    db.refresh(attachment)
    refreshed_ticket = db.scalar(_ticket_query().where(Ticket.id == ticket_id))
    tgt = refreshed_ticket or ticket
    _publish_ticket_update(db, tgt, action="ticket.attachment_added")
    return AttachmentRead.model_validate(attachment)


@router.get("/data/version")
def get_data_version(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    latest_update = db.scalar(select(func.max(Ticket.updated_at)))
    ticket_count = db.scalar(select(func.count(Ticket.id)))

    return {
        "latest_update": utc_iso_z(latest_update) if latest_update else None,
        "count": ticket_count or 0,
    }


@router.get("/data/experts")
def get_experts(
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(User).where(domain_expert_conditions())
    if project_id:
        stmt = stmt.join(User.projects).where(Project.id == project_id)
    stmt = stmt.order_by(User.username)
    experts = db.scalars(stmt).all()
    return [
        {"id": e.id, "username": e.username, "direction": e.direction}
        for e in experts
    ]
