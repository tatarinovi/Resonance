from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..access_policy import is_coordinator_role
from ..database import get_db
from ..deps import get_current_user
from ..models import Epic, EpicBlocker, EpicQAStatus, Ticket, TicketStatus, User, UserRole
from ..reference_data import EPIC_STATUS_LABELS, QA_STATUS_LABELS, QUESTION_PRIORITY_LABELS, QUESTION_STATUS_LABELS
from ..schemas import UserProfileStats, UserPublicProfile
from .dashboard import _apply_ticket_visibility, _ticket_query

router = APIRouter(tags=["aggregates"])


def _allowed_project_ids(user: User) -> list[int] | None:
    if user.role == UserRole.ADMIN:
        return None
    return [p.id for p in user.projects]


def _visible_tickets(db: Session, user: User) -> list[Ticket]:
    allowed = _allowed_project_ids(user)
    if allowed is not None and not allowed:
        return []
    stmt = _apply_ticket_visibility(_ticket_query(), user, allowed or [])
    return list(db.scalars(stmt).unique().all())


def _visible_epics(db: Session, user: User) -> list[Epic]:
    allowed = _allowed_project_ids(user)
    if allowed is not None and not allowed:
        return []
    stmt = select(Epic).options(
        selectinload(Epic.qa_block),
        selectinload(Epic.blockers),
        selectinload(Epic.test_runs),
    )
    if allowed is not None:
        stmt = stmt.where(Epic.project_id.in_(allowed))
    return list(db.scalars(stmt).unique().all())


def _hours_since(dt: datetime | None) -> float:
    if not dt:
        return 0
    return max(0, (datetime.utcnow() - dt).total_seconds() / 3600)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _first_team_response_hours(ticket: Ticket) -> float | None:
    if not ticket.created_at or not ticket.author_id:
        return None
    for message in sorted(ticket.messages or [], key=lambda m: m.created_at):
        if message.author_id is not None and message.author_id != ticket.author_id:
            diff = (message.created_at - ticket.created_at).total_seconds() / 3600
            return diff if diff >= 0 else None
    return None


def _ticket_title(ticket: Ticket) -> str:
    data = ticket.data_json or {}
    return ticket.title or data.get("title") or data.get("content") or f"Вопрос #{ticket.id}"


def _question_activity_heatmap(tickets: list[Ticket], user: User, days: int = 140) -> list[dict[str, int | str]]:
    today = datetime.utcnow().date()
    start = today - timedelta(days=days - 1)
    counts: dict[str, int] = {
        (start + timedelta(days=i)).isoformat(): 0
        for i in range(days)
    }

    def add(dt: datetime | None) -> None:
        if not dt or dt.date() < start or dt.date() > today:
            return
        key = dt.date().isoformat()
        counts[key] = counts.get(key, 0) + 1

    for ticket in tickets:
        if ticket.author_id == user.id:
            add(ticket.created_at)
        for message in ticket.messages or []:
            if message.author_id == user.id:
                add(message.created_at)
        for event in ticket.events or []:
            if event.actor_id == user.id:
                add(event.created_at)

    return [{"date": key, "count": counts[key]} for key in sorted(counts)]


def _profile_user_or_404(db: Session, viewer: User, user_id: int) -> User:
    profile_user = db.scalar(select(User).options(selectinload(User.projects)).where(User.id == user_id))
    if not profile_user or (not profile_user.is_approved and viewer.role != UserRole.ADMIN):
        raise HTTPException(status_code=404, detail="User not found")
    return profile_user


def _public_profile(user: User) -> UserPublicProfile:
    return UserPublicProfile(
        id=user.id,
        username=user.username,
        role=user.role,
        workspace=user.workspace,
        telegram_id=user.telegram_id,
        matrix_id=user.matrix_id,
        direction=user.direction,
        project_ids=[p.id for p in user.projects],
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _profile_stats_for_visible_tickets(tickets: list[Ticket], profile_user: User) -> UserProfileStats:
    authored = [t for t in tickets if t.author_id == profile_user.id]
    assigned_open = [
        t for t in tickets
        if t.assignee_id == profile_user.id and t.status not in {TicketStatus.CLOSED, TicketStatus.CANCELLED}
    ]
    return UserProfileStats(
        authored_total=len(authored),
        authored_closed=sum(1 for t in authored if t.status == TicketStatus.CLOSED),
        assigned_open=len(assigned_open),
        question_heatmap=_question_activity_heatmap(tickets, profile_user),
    )


def _qa_status_key(epic: Epic) -> str:
    raw = epic.qa_block.status if epic.qa_block else EpicQAStatus.DRAFT.value
    value = str(raw or EpicQAStatus.DRAFT.value).strip().lower()
    upper_map = {
        "draft": EpicQAStatus.DRAFT.value,
        "in_review": EpicQAStatus.IN_TESTING.value,
        "changes_requested": EpicQAStatus.BLOCKED.value,
        "approved": EpicQAStatus.PROD_COMPLETE.value,
    }
    return upper_map.get(value, value if value in QA_STATUS_LABELS else EpicQAStatus.DRAFT.value)


@router.get("/dashboard/summary")
def dashboard_summary(
    persona: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    tickets = _visible_tickets(db, user)
    epics = _visible_epics(db, user)
    users = list(db.scalars(select(User)).all()) if user.role == UserRole.ADMIN or is_coordinator_role(user) else []
    open_statuses = {TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, TicketStatus.RETURNED, TicketStatus.ANSWERED}
    open_tickets = [t for t in tickets if t.status in open_statuses]
    stale = sorted(
        [t for t in open_tickets if _hours_since(t.updated_at) > 48],
        key=lambda t: _hours_since(t.updated_at),
        reverse=True,
    )
    blocked_epics = [e for e in epics if any(b.resolved_at is None for b in (e.blockers or []))]
    role_counts: dict[str, int] = {}
    for row in users:
        role = row.role.value if row.role else "unknown"
        role_counts[role] = role_counts.get(role, 0) + 1
    status_counts: dict[str, int] = {status: 0 for status in QUESTION_STATUS_LABELS}
    for ticket in tickets:
        status_counts[ticket.status.value] = status_counts.get(ticket.status.value, 0) + 1
    return {
        "role": user.role.value,
        "persona": persona or user.role.value,
        "totals": {
            "questions_total": len(tickets),
            "questions_open": len(open_tickets),
            "active_epics": sum(1 for e in epics if e.status.value != "released"),
            "blocked_epics": len(blocked_epics),
            "users_total": len(users),
        },
        "status_counts": status_counts,
        "role_counts": role_counts,
        "stale_questions": [
            {
                "id": t.id,
                "title": _ticket_title(t),
                "updated_at": t.updated_at.isoformat(),
                "hours_stale": round(_hours_since(t.updated_at), 1),
            }
            for t in stale
        ],
    }


@router.get("/profile/stats", response_model=UserProfileStats)
def profile_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserProfileStats:
    tickets = _visible_tickets(db, user)
    return _profile_stats_for_visible_tickets(tickets, user)


@router.get("/users/{user_id}/profile", response_model=UserPublicProfile)
def user_public_profile(
    user_id: int,
    viewer: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublicProfile:
    profile_user = _profile_user_or_404(db, viewer, user_id)
    return _public_profile(profile_user)


@router.get("/users/{user_id}/profile/stats", response_model=UserProfileStats)
def user_public_profile_stats(
    user_id: int,
    viewer: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileStats:
    profile_user = _profile_user_or_404(db, viewer, user_id)
    tickets = _visible_tickets(db, viewer)
    return _profile_stats_for_visible_tickets(tickets, profile_user)


@router.get("/statistics/summary")
def statistics_summary(
    project_id: int | None = Query(default=None),
    epic_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    allowed = _allowed_project_ids(user)
    if project_id is not None and allowed is not None and project_id not in allowed:
        raise HTTPException(status_code=403, detail="Project access denied")

    tickets = _visible_tickets(db, user)
    epics = _visible_epics(db, user)
    if project_id is not None:
        tickets = [t for t in tickets if t.project_id == project_id]
        epics = [e for e in epics if e.project_id == project_id]
    if epic_id is not None:
        tickets = [t for t in tickets if t.epic_id == epic_id]
        epics = [e for e in epics if e.id == epic_id]

    open_tickets = [t for t in tickets if t.status not in {TicketStatus.CLOSED, TicketStatus.CANCELLED}]
    response_hours = [h for h in (_first_team_response_hours(t) for t in tickets) if h is not None]
    thread_counts = [len(t.messages or []) for t in tickets]
    q_status_counts = {key: 0 for key in QUESTION_STATUS_LABELS}
    priority_counts = {key: 0 for key in QUESTION_PRIORITY_LABELS}
    qa_counts = {key: 0 for key in QA_STATUS_LABELS}
    for ticket in tickets:
        q_status_counts[ticket.status.value] = q_status_counts.get(ticket.status.value, 0) + 1
        q_status_counts[QUESTION_STATUS_LABELS.get(ticket.status.value, ticket.status.value)] = q_status_counts[ticket.status.value]
        priority = ticket.priority or "medium"
        priority_counts[priority] = priority_counts.get(priority, 0) + 1
        priority_counts[QUESTION_PRIORITY_LABELS.get(priority, priority)] = priority_counts[priority]
    for epic in epics:
        qa_key = _qa_status_key(epic)
        qa_counts[qa_key] = qa_counts.get(qa_key, 0) + 1
        qa_counts[QA_STATUS_LABELS.get(qa_key, qa_key)] = qa_counts[qa_key]

    test_total = sum(len(e.test_runs or []) for e in epics)
    test_done = sum(1 for e in epics for run in (e.test_runs or []) if run.status == "passed")
    blocked_epics = [e for e in epics if any(isinstance(b, EpicBlocker) and b.resolved_at is None for b in (e.blockers or []))]

    return {
        "questions_total": len(tickets),
        "questions_open": len(open_tickets),
        "questions_closed": sum(1 for t in tickets if t.status in {TicketStatus.CLOSED, TicketStatus.CANCELLED}),
        "long_stagnant_open": sum(1 for t in open_tickets if _hours_since(t.updated_at) > 48),
        "active_epics": sum(1 for e in epics if e.status.value != "released"),
        "blocked_epics": len(blocked_epics),
        "avg_response_hours": (sum(response_hours) / len(response_hours)) if response_hours else None,
        "median_response_hours": _median(response_hours),
        "avg_thread_messages": (sum(thread_counts) / len(thread_counts)) if thread_counts else None,
        "with_team_reply": len(response_hours),
        "priority_counts": priority_counts,
        "question_status_counts": q_status_counts,
        "epic_qa_status_counts": qa_counts,
        "test_coverage": {
            "total": test_total,
            "done": test_done,
            "pct": round((test_done / test_total) * 100) if test_total else None,
        },
        "epic_status_counts": {key: sum(1 for e in epics if e.status.value == key) for key in EPIC_STATUS_LABELS},
    }
