"""Compute ticket assignee from status matrix (validation team, experts, author)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .expert_utils import domain_expert_conditions
from .access_policy import is_coordinator_role
from .directions import normalize_direction
from .models import Epic, Project, Ticket, TicketStatus, User, UserRole, user_projects
from .question_ticket_routing import QUESTION_ENG_DIRECTIONS


def _project_member_ids_subquery(project_id: int):
    return select(user_projects.c.user_id).where(user_projects.c.project_id == project_id)


def _normalize_validation_team(team: str | None) -> str | None:
    team_norm = normalize_direction(team)
    if not team_norm:
        return None
    if team_norm == "manager":
        return "coordinator"
    return team_norm


def _first_coordinator_for_team(db: Session, project_id: int, validation_team: str | None) -> int | None:
    team_norm = _normalize_validation_team(validation_team)
    candidates = [u for u in db.scalars(select(User).where(User.id.in_(_project_member_ids_subquery(project_id))).order_by(User.id)).all() if is_coordinator_role(u)]
    if team_norm:
        if team_norm == "coordinator":
            for u in candidates:
                if u.direction in ("coordinator", "manager"):
                    return u.id
            return candidates[0].id if candidates else None
        for u in candidates:
            if normalize_direction(u.direction) == team_norm:
                return u.id
    return candidates[0].id if candidates else None


def _first_project_admin(db: Session, project_id: int) -> int | None:
    stmt = (
        select(User.id)
        .where(User.id.in_(_project_member_ids_subquery(project_id)))
        .where(User.role == UserRole.ADMIN)
        .order_by(User.id)
    )
    return db.scalar(stmt)


def _first_project_user_by_direction(db: Session, project_id: int, direction: str) -> int | None:
    direction_norm = normalize_direction(direction)
    for user in db.scalars(
        select(User)
        .where(User.id.in_(_project_member_ids_subquery(project_id)))
        .order_by(User.id)
    ).all():
        if normalize_direction(user.direction) == direction_norm:
            return user.id
    return None


def _resolve_forwarded_assignee(db: Session, ticket: Ticket) -> int | None:
    project = db.get(Project, ticket.project_id)
    if not project:
        return None
    data = ticket.data_json or {}
    direction = data.get("target_direction")
    direction_str = direction if isinstance(direction, str) else None
    direction_str = normalize_direction(direction_str)

    if direction_str and direction_str in QUESTION_ENG_DIRECTIONS:
        uid = _first_project_user_by_direction(db, project.id, direction_str)
        if uid is not None:
            return uid
        return _first_project_admin(db, project.id)

    epic: Epic | None = None
    if ticket.epic_id:
        epic = db.get(Epic, ticket.epic_id)
    epic_title = data.get("epic_name")
    if epic is None and epic_title:
        epic = db.scalar(select(Epic).where(Epic.project_id == project.id, Epic.title == epic_title))

    if epic and direction_str == "analytics" and epic.lead_analyst_id:
        return epic.lead_analyst_id
    if epic and direction_str == "design" and epic.lead_designer_id:
        return epic.lead_designer_id

    stmt = select(User).where(domain_expert_conditions())
    experts = db.scalars(stmt).all()
    for expert in experts:
        if direction_str and normalize_direction(expert.direction) != direction_str:
            continue
        if project.id in {p.id for p in expert.projects}:
            return expert.id
    return None


def compute_assignee_for_status(db: Session, ticket: Ticket, status: TicketStatus) -> int | None:
    data = ticket.data_json or {}

    if status in (TicketStatus.CLOSED, TicketStatus.CANCELLED):
        return None

    if status == TicketStatus.PENDING_APPROVAL:
        if data.get("reopened_to_author") and ticket.author_id is not None:
            return ticket.author_id
        team = data.get("validation_team")
        uid = _first_coordinator_for_team(db, ticket.project_id, team if isinstance(team, str) else None)
        if uid is not None:
            return uid
        return _first_project_admin(db, ticket.project_id)

    if status == TicketStatus.FORWARDED:
        if data.get("expert_assignee_manual") and ticket.assignee_id is not None:
            return ticket.assignee_id
        return _resolve_forwarded_assignee(db, ticket)

    if status in (TicketStatus.RETURNED, TicketStatus.ANSWERED):
        return ticket.author_id

    return ticket.assignee_id
