"""Кто считается экспертом по вопросам: роль expert или доменные лиды (аналитика / дизайн)."""

from __future__ import annotations

from sqlalchemy import and_, or_

from .models import Ticket, TicketStatus, User, UserRole
from .access_policy import is_coordinator_role
from .directions import normalize_direction

# Совпадает с target_direction в тикетах и конфигом комнат (см. notification_service).
EXPERT_DIRECTIONS = frozenset({"analytics", "design"})
ENG_TICKET_DIRECTIONS = frozenset({"qa", "front", "back"})


def user_is_ticket_expert(user: User) -> bool:
    if user.role == UserRole.EXPERT:
        return True
    if user.role == UserRole.EMPLOYEE and normalize_direction(user.direction) in EXPERT_DIRECTIONS:
        return True
    return False


def domain_expert_conditions():
    """Условие SQLAlchemy: пользователь — эксперт по роли или по направлению аналитики/дизайна."""
    return or_(
        User.role == UserRole.EXPERT,
        and_(User.role == UserRole.EMPLOYEE, User.direction.in_(tuple(EXPERT_DIRECTIONS))),
    )


def expert_is_assign_candidate_for_ticket(ticket: Ticket, candidate: User) -> bool:
    """Эксперт состоит в проекте тикета и подходит под target_direction (если задан)."""
    if not user_is_ticket_expert(candidate):
        return False
    if ticket.project_id not in {p.id for p in candidate.projects}:
        return False
    data = ticket.data_json or {}
    td = normalize_direction(data.get("target_direction") if isinstance(data.get("target_direction"), str) else None)
    if isinstance(td, str) and td in EXPERT_DIRECTIONS:
        return normalize_direction(candidate.direction) == td
    return True


def assignee_candidate_for_forwarded_ticket(ticket: Ticket, candidate: User) -> bool:
    """Кандидат на исполнение в статусе forwarded: лид направления QA/Front/Back или доменный эксперт."""
    if ticket.project_id not in {p.id for p in candidate.projects}:
        return False
    if not candidate.is_approved:
        return False
    data = ticket.data_json or {}
    td = normalize_direction(data.get("target_direction") if isinstance(data.get("target_direction"), str) else None)
    if not isinstance(td, str):
        return False
    if td in ENG_TICKET_DIRECTIONS:
        return normalize_direction(candidate.direction) == td
    return expert_is_assign_candidate_for_ticket(ticket, candidate)


def assignee_candidate_for_cross_direction_pool(ticket: Ticket, candidate: User) -> bool:
    """Участники проекта для передачи между направлениями (Jira-подобный пул): доменные эксперты + QA/Front/Back."""
    if ticket.project_id not in {p.id for p in candidate.projects}:
        return False
    if not candidate.is_approved:
        return False
    if user_is_ticket_expert(candidate):
        return True
    return normalize_direction(candidate.direction) in ENG_TICKET_DIRECTIONS


def suggested_target_direction_for_assignee(user: User) -> str | None:
    """Slug для data_json.target_direction после назначения пользователя (если известен)."""
    d = normalize_direction(user.direction)
    if d in EXPERT_DIRECTIONS or d in ENG_TICKET_DIRECTIONS:
        return d
    return None


def user_may_claim_forwarded_ticket(ticket: Ticket, user: User) -> bool:
    """Можно ли «забрать» forwarded-вопрос на себя (не текущий ответственный)."""
    if ticket.status != TicketStatus.FORWARDED:
        return False
    if ticket.assignee_id is None or ticket.assignee_id == user.id:
        return False
    if ticket.project_id not in {p.id for p in user.projects}:
        return False
    if not user.is_approved:
        return False
    if user.role == UserRole.ADMIN or is_coordinator_role(user):
        return True
    if ticket.author_id is not None and ticket.author_id == user.id:
        return False
    return assignee_candidate_for_cross_direction_pool(ticket, user)
