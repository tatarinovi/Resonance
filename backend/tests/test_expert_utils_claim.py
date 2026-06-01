"""Tests for cross-direction assignee pool and claim eligibility."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.expert_utils import (
    assignee_candidate_for_cross_direction_pool,
    user_may_claim_forwarded_ticket,
)
from app.models import TicketStatus, UserRole


def _project(pid: int) -> MagicMock:
    p = MagicMock()
    p.id = pid
    return p


def _user(
    uid: int,
    *,
    role: UserRole = UserRole.EMPLOYEE,
    direction: str | None = None,
    project_ids: tuple[int, ...] = (1,),
    is_approved: bool = True,
) -> MagicMock:
    u = MagicMock()
    u.id = uid
    u.role = role
    u.direction = direction
    u.is_approved = is_approved
    u.projects = [_project(pid) for pid in project_ids]
    return u


def _ticket(
    *,
    project_id: int = 1,
    status: TicketStatus = TicketStatus.FORWARDED,
    assignee_id: int | None = 10,
    author_id: int | None = 99,
    data_json: dict | None = None,
) -> MagicMock:
    t = MagicMock()
    t.project_id = project_id
    t.status = status
    t.assignee_id = assignee_id
    t.author_id = author_id
    t.data_json = data_json or {"target_direction": "design"}
    return t


def test_cross_pool_includes_qa_on_design_ticket() -> None:
    ticket = _ticket()
    qa = _user(20, direction="qa")
    assert assignee_candidate_for_cross_direction_pool(ticket, qa)


def test_cross_pool_excludes_other_project() -> None:
    ticket = _ticket(project_id=1)
    qa = _user(20, direction="qa", project_ids=(2,))
    assert not assignee_candidate_for_cross_direction_pool(ticket, qa)


def test_cross_pool_excludes_unapproved() -> None:
    ticket = _ticket()
    u = _user(20, direction="analytics", is_approved=False)
    assert not assignee_candidate_for_cross_direction_pool(ticket, u)


def test_claim_allowed_for_qa_when_not_assignee() -> None:
    ticket = _ticket(assignee_id=10, author_id=99)
    qa = _user(20, direction="qa")
    assert user_may_claim_forwarded_ticket(ticket, qa)


def test_claim_denied_for_author_non_manager() -> None:
    ticket = _ticket(assignee_id=10, author_id=5)
    author = _user(5, direction="qa")
    assert not user_may_claim_forwarded_ticket(ticket, author)


def test_claim_allowed_for_manager_even_if_author() -> None:
    ticket = _ticket(assignee_id=10, author_id=5)
    mgr = _user(5, role=UserRole.COORDINATOR, direction=None)
    assert user_may_claim_forwarded_ticket(ticket, mgr)


def test_claim_denied_when_already_assignee() -> None:
    ticket = _ticket(assignee_id=10)
    same = _user(10, direction="qa")
    assert not user_may_claim_forwarded_ticket(ticket, same)

