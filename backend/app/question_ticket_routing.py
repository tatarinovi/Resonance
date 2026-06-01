"""Rules for creating tickets as «questions»: audience slugs, initial status, data_json flags."""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException

from .expert_utils import EXPERT_DIRECTIONS
from .models import Epic, TicketStatus, User, UserRole
from .access_policy import is_coordinator_role
from .directions import normalize_direction

QUESTION_DOMAIN_DIRECTIONS = frozenset({"analytics", "design"})
QUESTION_ENG_DIRECTIONS = frozenset({"qa", "front", "back"})
QUESTION_COORDINATOR_SLUG = "coordinator"
QUESTION_LEGACY_MANAGER_SLUG = "manager"
QUESTION_ALL_AUDIENCE = QUESTION_DOMAIN_DIRECTIONS | QUESTION_ENG_DIRECTIONS | {QUESTION_COORDINATOR_SLUG}


def _author_bucket(user: User) -> Literal["admin", "coordinator", "expert", "employee_domain", "employee_dev"]:
    if user.role == UserRole.ADMIN:
        return "admin"
    if is_coordinator_role(user):
        return "coordinator"
    if user.role == UserRole.EXPERT:
        return "expert"
    if user.role == UserRole.EMPLOYEE and normalize_direction(user.direction) in EXPERT_DIRECTIONS:
        return "employee_domain"
    return "employee_dev"


def allowed_audience_slugs_for_author(user: User) -> frozenset[str]:
    b = _author_bucket(user)
    if b == "admin":
        return QUESTION_ALL_AUDIENCE
    if b == "coordinator":
        return QUESTION_ALL_AUDIENCE
    if b == "expert":
        return QUESTION_ENG_DIRECTIONS
    if b in ("employee_dev", "employee_domain"):
        return QUESTION_DOMAIN_DIRECTIONS
    return frozenset()


def initial_status_for_new_question(*, audience: str, user: User) -> TicketStatus:
    """Coordinator/admin approve implicitly; expert questions go to coordinator review."""
    b = _author_bucket(user)
    if b in ("coordinator", "admin") and audience != QUESTION_COORDINATOR_SLUG:
        return TicketStatus.FORWARDED
    return TicketStatus.PENDING_APPROVAL


def validation_team_for_new_question(*, audience: str, user: User) -> str:
    """Team responsible for the pending-approval step, distinct from the final expert audience."""
    b = _author_bucket(user)
    user_direction = normalize_direction(user.direction)
    if b == "expert":
        return audience
    if b == "employee_dev" and user_direction in QUESTION_ENG_DIRECTIONS:
        return user_direction
    if b == "employee_domain" and user_direction:
        return user_direction
    return audience


def is_expert_track_ticket(*, initial_status: TicketStatus, audience: str) -> bool:
    """Used in coordinator visibility filter (is_expert_ticket in data_json)."""
    return initial_status == TicketStatus.FORWARDED and audience in QUESTION_ENG_DIRECTIONS


def validate_audience_for_author(*, user: User, audience: str | None) -> str:
    if not audience or not isinstance(audience, str):
        raise HTTPException(status_code=422, detail="target_direction (audience) is required")
    aud = normalize_direction(audience)
    if not aud:
        raise HTTPException(status_code=422, detail="target_direction (audience) is required")
    if aud == QUESTION_LEGACY_MANAGER_SLUG:
        aud = QUESTION_COORDINATOR_SLUG
    allowed = allowed_audience_slugs_for_author(user)
    if aud not in allowed:
        raise HTTPException(status_code=403, detail="This audience is not allowed for your role")
    return aud


def assert_epic_belongs_to_project(epic: Epic, project_id: int) -> None:
    if epic.project_id != project_id:
        raise HTTPException(status_code=422, detail="Epic does not belong to the selected project")
