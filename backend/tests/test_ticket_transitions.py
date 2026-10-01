"""Unit tests for ticket status transition ACL."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.models import TicketStatus, UserRole
from app.routers.dashboard import _allowed_ticket_target_statuses, _is_ticket_transition_allowed


def _user(role: UserRole, username: str = "alice", direction: str | None = None) -> MagicMock:
    u = MagicMock()
    u.role = role
    u.username = username
    u.direction = direction
    return u


@pytest.mark.parametrize(
    ("role", "old_s", "new_s", "author", "user_name", "direction", "target_direction", "expected"),
    [
        (UserRole.COORDINATOR, TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, "bob", "mgr", None, None, True),
        (UserRole.COORDINATOR, TicketStatus.PENDING_APPROVAL, TicketStatus.RETURNED, "bob", "mgr", None, None, True),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.RETURNED, "bob", "exp", None, "design", False),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "exp", None, "design", False),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "exp", "design", "design", True),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.RETURNED, "bob", "exp", "design", "design", True),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "exp", "design", "analytics", False),
        (UserRole.EXPERT, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "exp", "qa", "design", False),
        (UserRole.COORDINATOR, TicketStatus.FORWARDED, TicketStatus.RETURNED, "bob", "mgr", None, "design", True),
        (UserRole.EMPLOYEE, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "alice", None, "design", False),
        (UserRole.EMPLOYEE, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "ana", "analytics", "analytics", True),
        (UserRole.EMPLOYEE, TicketStatus.FORWARDED, TicketStatus.RETURNED, "bob", "ana", "analytics", "analytics", True),
        (UserRole.EMPLOYEE, TicketStatus.FORWARDED, TicketStatus.ANSWERED, "bob", "ana", "analytics", "design", False),
        (UserRole.COORDINATOR, TicketStatus.PENDING_APPROVAL, TicketStatus.CANCELLED, "bob", "mgr", None, None, True),
        (UserRole.EMPLOYEE, TicketStatus.PENDING_APPROVAL, TicketStatus.CANCELLED, "alice", "alice", None, None, True),
        (UserRole.EMPLOYEE, TicketStatus.PENDING_APPROVAL, TicketStatus.CANCELLED, "bob", "alice", None, None, False),
        (UserRole.EXPERT, TicketStatus.PENDING_APPROVAL, TicketStatus.FORWARDED, "bob", "exp", "design", "design", False),
        (UserRole.EMPLOYEE, TicketStatus.ANSWERED, TicketStatus.CLOSED, "alice", "alice", None, None, True),
        (UserRole.COORDINATOR, TicketStatus.ANSWERED, TicketStatus.CLOSED, "bob", "mgr", None, None, True),
        (UserRole.EXPERT, TicketStatus.ANSWERED, TicketStatus.CLOSED, "bob", "exp", "design", "design", False),
        (UserRole.COORDINATOR, TicketStatus.CLOSED, TicketStatus.PENDING_APPROVAL, "bob", "mgr", None, None, True),
        (UserRole.EMPLOYEE, TicketStatus.CLOSED, TicketStatus.PENDING_APPROVAL, "bob", "alice", None, None, False),
        (UserRole.COORDINATOR, TicketStatus.CANCELLED, TicketStatus.PENDING_APPROVAL, "bob", "mgr", None, None, True),
    ],
)
def test_transition_matrix(
    role: UserRole,
    old_s: TicketStatus,
    new_s: TicketStatus,
    author: str,
    user_name: str,
    direction: str | None,
    target_direction: str | None,
    expected: bool,
) -> None:
    u = _user(role, user_name, direction)
    assert (
        _is_ticket_transition_allowed(
            user=u,
            author_name=author,
            old_status=old_s,
            new_status=new_s,
            assignee_id=None,
            target_direction=target_direction,
        )
        == expected
    )


def test_assignee_can_answer_forwarded_without_expert_utils() -> None:
    u = _user(UserRole.EMPLOYEE, "qalead", "qa")
    u.id = 42
    assert _is_ticket_transition_allowed(
        user=u,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        new_status=TicketStatus.ANSWERED,
        assignee_id=42,
    )


def test_assignee_can_return_forwarded_for_clarification() -> None:
    u = _user(UserRole.EMPLOYEE, "qalead", "qa")
    u.id = 42
    assert _is_ticket_transition_allowed(
        user=u,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        new_status=TicketStatus.RETURNED,
        assignee_id=42,
    )


def test_assignee_expert_can_answer_without_direction_match() -> None:
    """The current assignee keeps the answer/return short-circuit."""
    u = _user(UserRole.EXPERT, "designer", "design")
    u.id = 7
    assert _is_ticket_transition_allowed(
        user=u,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        new_status=TicketStatus.ANSWERED,
        assignee_id=7,
        target_direction="analytics",
    )
    assert _is_ticket_transition_allowed(
        user=u,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        new_status=TicketStatus.RETURNED,
        assignee_id=7,
        target_direction=None,
    )


def test_non_assignee_expert_allowed_statuses_follow_direction() -> None:
    design = _user(UserRole.EXPERT, "designer", "design")
    design.id = 7
    matching = _allowed_ticket_target_statuses(
        user=design,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        assignee_id=None,
        target_direction="design",
    )
    assert TicketStatus.ANSWERED in matching
    assert TicketStatus.RETURNED in matching

    other = _allowed_ticket_target_statuses(
        user=design,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        assignee_id=99,
        target_direction="analytics",
    )
    assert TicketStatus.ANSWERED not in other
    assert TicketStatus.RETURNED not in other

    missing = _allowed_ticket_target_statuses(
        user=_user(UserRole.EXPERT, "blank", None),
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        assignee_id=None,
        target_direction="design",
    )
    assert missing == []


def test_non_assignee_employee_cannot_answer_if_not_expert() -> None:
    u = _user(UserRole.EMPLOYEE, "other", "qa")
    u.id = 1
    assert not _is_ticket_transition_allowed(
        user=u,
        author_name="bob",
        old_status=TicketStatus.FORWARDED,
        new_status=TicketStatus.ANSWERED,
        assignee_id=99,
    )
    mgr = _user(UserRole.COORDINATOR, "mgr")
    author_name = "bob"
    allowed = _allowed_ticket_target_statuses(
        user=mgr, author_name=author_name, old_status=TicketStatus.PENDING_APPROVAL, assignee_id=None
    )
    assert TicketStatus.FORWARDED in allowed
    assert TicketStatus.RETURNED in allowed
    assert TicketStatus.CANCELLED in allowed
    assert len(allowed) == 3

