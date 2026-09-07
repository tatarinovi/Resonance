"""Release read models, safe audit helpers, and lifecycle-aware readiness."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .access_policy import AccessPolicy
from .config import get_settings
from .models import (
    AppSetting,
    Epic,
    EpicExternalSyncState,
    EpicJiraIssue,
    EpicQAStatus,
    EpicTestOpsProblemCase,
    EpicTestOpsSnapshot,
    EpicTestRun,
    Release,
    ReleaseAuditLog,
    ReleaseEpicMembership,
    ReleaseStatus,
    TestRunEnvironment,
    TestRunStatus,
    Ticket,
    TicketStatus,
    User,
    UserRole,
)
from .schemas import ReleaseCapabilities, ReleaseEpicSummary, ReleaseRead


TERMINAL_RELEASE_STATUSES = {ReleaseStatus.RELEASED, ReleaseStatus.CANCELLED}
ACTIVE_RELEASE_STATUSES = {ReleaseStatus.DRAFT, ReleaseStatus.IN_PROGRESS, ReleaseStatus.READY}
OPEN_TICKET_STATUSES = {
    TicketStatus.PENDING_APPROVAL,
    TicketStatus.FORWARDED,
    TicketStatus.RETURNED,
    TicketStatus.ANSWERED,
}
AUDIT_DETAIL_KEYS = {
    "fields", "old_status", "new_status", "epic_ids", "epic_id", "reason", "counts",
    "outcome", "source", "result", "error_code", "message", "archived", "owner_user_id",
}


def release_status(value: ReleaseStatus | str) -> ReleaseStatus:
    if isinstance(value, ReleaseStatus):
        return value
    raw = str(value).strip()
    try:
        return ReleaseStatus(raw.lower())
    except ValueError:
        return ReleaseStatus[raw.upper()]


def status_value(value: ReleaseStatus | str) -> str:
    return release_status(value).value


def release_query():
    return select(Release).options(
        selectinload(Release.project),
        selectinload(Release.owner),
        selectinload(Release.memberships).selectinload(ReleaseEpicMembership.epic).selectinload(Epic.qa_block),
        selectinload(Release.memberships).selectinload(ReleaseEpicMembership.epic).selectinload(Epic.blockers),
        selectinload(Release.memberships).selectinload(ReleaseEpicMembership.epic).selectinload(Epic.test_runs),
    )


def current_memberships(release: Release) -> list[ReleaseEpicMembership]:
    return [membership for membership in release.memberships or [] if membership.removed_at is None]


def current_epics(release: Release) -> list[Epic]:
    return [membership.epic for membership in current_memberships(release) if membership.epic is not None]


def safe_audit_details(details: dict[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in (details or {}).items():
        if key not in AUDIT_DETAIL_KEYS:
            continue
        if isinstance(value, str):
            result[key] = value[:500]
        elif isinstance(value, list):
            result[key] = value[:100]
        elif isinstance(value, dict):
            result[key] = {
                str(nested_key)[:100]: nested_value if isinstance(nested_value, (int, float, bool, type(None))) else str(nested_value)[:200]
                for nested_key, nested_value in list(value.items())[:100]
            }
        elif isinstance(value, (int, float, bool)) or value is None:
            result[key] = value
    return result


def add_release_audit(db: Session, release: Release, actor: User | None, action: str, details: dict[str, Any] | None = None) -> None:
    db.add(ReleaseAuditLog(
        release_id=release.id,
        actor_user_id=actor.id if actor else None,
        action=action[:100],
        details_json=safe_audit_details(details),
    ))


def capabilities(user: User, release: Release) -> ReleaseCapabilities:
    can_manage = AccessPolicy.can_manage_release(user, release)
    current = release_status(release.status)
    allowed = AccessPolicy.release_allowed_transitions(release) if can_manage else []
    return ReleaseCapabilities(
        can_edit_release=can_manage,
        can_manage_epics=can_manage and (current in ACTIVE_RELEASE_STATUSES or user.role == UserRole.ADMIN),
        can_refresh_data=can_manage and current in ACTIVE_RELEASE_STATUSES,
        can_change_status=bool(allowed),
        allowed_status_transitions=[item.value for item in allowed],
        can_archive=user.role == UserRole.ADMIN and current in TERMINAL_RELEASE_STATUSES,
        can_delete=user.role == UserRole.ADMIN and current == ReleaseStatus.DRAFT,
    )


def _qa_status(epic: Epic) -> str | None:
    raw = epic.qa_block.status if epic.qa_block else None
    return str(raw or "").strip().lower() or None


def _sync_states(db: Session, epic_ids: Iterable[int]) -> dict[tuple[int, str], EpicExternalSyncState]:
    ids = list(epic_ids)
    if not ids:
        return {}
    rows = db.scalars(select(EpicExternalSyncState).where(EpicExternalSyncState.epic_id.in_(ids))).all()
    return {(row.epic_id, row.source): row for row in rows}


def _freshness(state: EpicExternalSyncState | None) -> dict[str, Any]:
    if state is None or state.last_success_at is None:
        return {
            "status": "data_unavailable",
            "last_success_at": None,
            "last_attempt_at": state.last_attempt_at if state else None,
            "error_code": state.last_error_code if state else None,
            "message": state.last_error_message if state else None,
        }
    stale_before = datetime.utcnow() - timedelta(hours=get_settings().release_external_data_stale_hours)
    status = "integration_failure" if state.last_error_code else ("stale" if state.last_success_at < stale_before else "fresh")
    return {
        "status": status,
        "last_success_at": state.last_success_at,
        "last_attempt_at": state.last_attempt_at,
        "error_code": state.last_error_code,
        "message": state.last_error_message,
        "item_count": state.item_count,
    }


def _open_questions_count(db: Session, epic_id: int) -> int:
    return int(db.scalar(select(func.count(Ticket.id)).where(
        Ticket.epic_id == epic_id,
        Ticket.status.in_(OPEN_TICKET_STATUSES),
    )) or 0)


def _epic_summary(db: Session, epic: Epic, states: dict[tuple[int, str], EpicExternalSyncState]) -> ReleaseEpicSummary:
    jira_count = int(db.scalar(select(func.count(EpicJiraIssue.id)).where(EpicJiraIssue.epic_id == epic.id)) or 0)
    return ReleaseEpicSummary(
        id=epic.id,
        key=f"EP-{epic.id:03d}",
        title=epic.title,
        status=epic.status.value if hasattr(epic.status, "value") else str(epic.status).lower(),
        qa_status=_qa_status(epic),
        project_id=epic.project_id,
        jira_tasks_count=jira_count,
        open_questions_count=_open_questions_count(db, epic.id),
        blockers_count=sum(1 for blocker in epic.blockers or [] if blocker.resolved_at is None),
        freshness={
            "jira": _freshness(states.get((epic.id, "jira"))) if (epic.jira_jql or "").strip() else {"status": "source_not_configured"},
            "testops": _freshness(states.get((epic.id, "testops"))) if any(run.testops_launch_id for run in epic.test_runs or []) else {"status": "source_not_configured"},
        },
    )


def release_to_read(db: Session, release: Release, user: User, *, include_epics: bool = True) -> ReleaseRead:
    epics = current_epics(release)
    states = _sync_states(db, [epic.id for epic in epics])
    assessment = build_release_assessment(db, release, states=states)
    epic_summaries = [_epic_summary(db, epic, states) for epic in epics] if include_epics else []
    open_questions = sum(_open_questions_count(db, epic.id) for epic in epics)
    freshness = {
        "jira": [summary.freshness["jira"] for summary in epic_summaries],
        "testops": [summary.freshness["testops"] for summary in epic_summaries],
        "kanban": kanban_freshness(db),
    }
    return ReleaseRead(
        id=release.id,
        key=release.key,
        project_id=release.project_id,
        project_name=release.project.name if release.project else None,
        sequence_number=release.sequence_number,
        title=release.title,
        description=release.description,
        status=status_value(release.status),
        planned_release_at=release.planned_release_at,
        released_at=release.released_at,
        owner_user_id=release.owner_user_id,
        owner_username=release.owner.username if release.owner else None,
        release_note=release.release_note,
        created_by_id=release.created_by_id,
        archived_at=release.archived_at,
        created_at=release.created_at,
        updated_at=release.updated_at,
        epic_count=len(epics),
        risk_counts=assessment["summary"]["risk_counts"],
        open_questions_count=open_questions,
        capabilities=capabilities(user, release),
        epics=epic_summaries,
        freshness=freshness,
    )


def _attention(kind: str, source: str, epic: Epic, message: str, *, severity: str = "warning", entity: dict | None = None, timestamp: datetime | None = None) -> dict:
    return {
        "kind": kind,
        "source": source,
        "severity": severity,
        "epic": {"id": epic.id, "key": f"EP-{epic.id:03d}", "title": epic.title},
        "entity": entity,
        "message": message,
        "timestamp": timestamp,
    }


def _priority_sets() -> tuple[set[str], set[str]]:
    settings = get_settings()
    blocker = {value.strip().casefold() for value in settings.jira_blocker_priority_names.split(",") if value.strip()}
    critical = {value.strip().casefold() for value in settings.jira_critical_priority_names.split(",") if value.strip()}
    return blocker, critical


def build_release_assessment(
    db: Session,
    release: Release,
    *,
    target_status: ReleaseStatus | None = None,
    states: dict[tuple[int, str], EpicExternalSyncState] | None = None,
) -> dict[str, Any]:
    epics = current_epics(release)
    epic_ids = [epic.id for epic in epics]
    states = states or _sync_states(db, epic_ids)
    actual: list[dict] = []
    warnings: list[dict] = []
    gaps: list[dict] = []
    blocker_priorities, critical_priorities = _priority_sets()
    strict_qa = (target_status or release_status(release.status)) in {ReleaseStatus.READY, ReleaseStatus.RELEASED}

    jira_rows = db.scalars(select(EpicJiraIssue).where(EpicJiraIssue.epic_id.in_(epic_ids))).all() if epic_ids else []
    epic_by_id = {epic.id: epic for epic in epics}
    seen_jira: set[str] = set()
    for issue in jira_rows:
        priority = (issue.priority or "").casefold()
        severity = "blocker" if priority in blocker_priorities else ("critical" if priority in critical_priorities else None)
        if severity and issue.jira_issue_key not in seen_jira:
            seen_jira.add(issue.jira_issue_key)
            epic = epic_by_id[issue.epic_id]
            actual.append(_attention(
                f"jira_{severity}", "jira", epic, f"{issue.jira_issue_key}: {issue.summary}",
                severity=severity,
                entity={"key": issue.jira_issue_key, "title": issue.summary, "url": issue.browser_url},
                timestamp=issue.refreshed_at,
            ))

    now = datetime.utcnow()
    testops_cases = db.scalars(
        select(EpicTestOpsProblemCase)
        .join(EpicTestOpsSnapshot, EpicTestOpsSnapshot.test_run_id == EpicTestOpsProblemCase.test_run_id)
        .join(EpicTestRun, EpicTestRun.id == EpicTestOpsSnapshot.test_run_id)
        .where(EpicTestRun.epic_id.in_(epic_ids))
    ).all() if epic_ids else []
    run_epic = {run.id: epic for epic in epics for run in epic.test_runs or []}
    for case in testops_cases:
        if case.status.lower() in {"failed", "broken", "blocked"} and case.test_run_id in run_epic:
            actual.append(_attention(
                f"testops_{case.status.lower()}", "testops", run_epic[case.test_run_id], case.case_name,
                severity="blocker", entity={"title": case.case_name, "url": case.external_url},
            ))

    for epic in epics:
        for blocker in epic.blockers or []:
            if blocker.resolved_at is None:
                actual.append(_attention("local_blocker", "resonance", epic, blocker.body, severity="blocker", timestamp=blocker.created_at))
        for run in epic.test_runs or []:
            if str(run.status).lower() == TestRunStatus.FAILED.value:
                actual.append(_attention("qa_failed", "qa", epic, f"{str(run.environment).upper()} run failed", severity="blocker", timestamp=run.finished_at or run.created_at))

        tickets = db.scalars(select(Ticket).where(Ticket.epic_id == epic.id)).all()
        for ticket in tickets:
            if ticket.due_at and ticket.due_at < now and ticket.status not in {TicketStatus.ANSWERED, TicketStatus.CLOSED, TicketStatus.CANCELLED}:
                actual.append(_attention(
                    "overdue_question", "questions", epic, ticket.title or ticket.description or f"Question Q-{ticket.id:03d}",
                    severity="critical", entity={"id": ticket.id, "key": f"Q-{ticket.id:03d}", "url": f"/questions/Q-{ticket.id:03d}"}, timestamp=ticket.due_at,
                ))

        runs = list(epic.test_runs or [])
        if runs:
            prod = next((run for run in runs if str(run.environment).lower() == TestRunEnvironment.PROD.value), None)
            qa_complete = _qa_status(epic) in {EpicQAStatus.PROD_COMPLETE.value, EpicQAStatus.CLOSED.value}
            incompleteness: list[str] = []
            if not qa_complete:
                incompleteness.append("QA lifecycle не завершён до PROD")
            if prod is None:
                incompleteness.append("Нет PROD run")
            elif str(prod.status).lower() != TestRunStatus.PASSED.value:
                incompleteness.append("PROD run не пройден")
            for message in incompleteness:
                item = _attention("qa_incomplete", "qa", epic, message, severity="critical" if strict_qa else "warning")
                (actual if strict_qa else warnings).append(item)

        jira_state = states.get((epic.id, "jira"))
        testops_state = states.get((epic.id, "testops"))
        has_jira_coverage = bool(jira_state and jira_state.last_success_at)
        linked_testops = [run for run in runs if run.testops_launch_id]
        has_run_coverage = bool(runs) and (not linked_testops or bool(testops_state and testops_state.last_success_at))
        if not has_jira_coverage and not has_run_coverage:
            gaps.append(_attention("data_unavailable", "release", epic, "Недостаточно Jira/QA данных", severity="info"))
        if not (epic.jira_jql or "").strip():
            warnings.append(_attention("source_not_configured", "jira", epic, "Jira не настроена для Epic", severity="info"))
        if not runs:
            warnings.append(_attention("source_not_configured", "testops", epic, "Нет TestOps run", severity="info"))
        for source, state in (("jira", jira_state), ("testops", testops_state)):
            fresh = _freshness(state)
            if fresh["status"] in {"stale", "integration_failure"}:
                warnings.append(_attention(fresh["status"], source, epic, fresh.get("message") or f"Данные {source} требуют обновления", severity="warning", timestamp=fresh.get("last_success_at")))

    readiness = "has_risks" if actual else ("no_data" if not epics or gaps else "ready")
    counts: dict[str, int] = {}
    for item in actual:
        counts[item["kind"]] = counts.get(item["kind"], 0) + 1
    jira_unique = {row.jira_issue_key: row for row in jira_rows}
    jira_by_status: dict[str, int] = {}
    jira_by_priority: dict[str, int] = {}
    jira_by_type: dict[str, int] = {}
    for issue in jira_unique.values():
        for target, value in ((jira_by_status, issue.status), (jira_by_priority, issue.priority), (jira_by_type, issue.issue_type)):
            label = str(value or "Не задано")
            target[label] = target.get(label, 0) + 1

    qa_counts = {key: 0 for key in ("total", "passed", "failed", "broken", "blocked", "in_progress")}
    current_runs: list[dict[str, Any]] = []
    for epic in epics:
        active_stage = str(epic.qa_block.active_test_stage if epic.qa_block else "test").lower()
        run = next((candidate for candidate in epic.test_runs or [] if str(candidate.environment).lower() == active_stage), None)
        snapshot = run.testops_snapshot if run else None
        if snapshot:
            for key in qa_counts:
                qa_counts[key] += int(getattr(snapshot, key, 0) or 0)
        current_runs.append({
            "epic": {"id": epic.id, "key": f"EP-{epic.id:03d}", "title": epic.title},
            "environment": active_stage,
            "run": None if run is None else {
                "id": run.id, "status": run.status, "url": run.url,
                "snapshot": None if snapshot is None else {
                    "status": snapshot.status, "total": snapshot.total, "passed": snapshot.passed,
                    "failed": snapshot.failed, "broken": snapshot.broken, "blocked": snapshot.blocked,
                    "in_progress": snapshot.in_progress, "synced_at": snapshot.synced_at,
                },
            },
        })
    qa_counts["completed"] = qa_counts["passed"] + qa_counts["failed"] + qa_counts["broken"] + qa_counts["blocked"]
    qa_counts["progress_percent"] = round(qa_counts["completed"] / qa_counts["total"] * 100) if qa_counts["total"] else 0

    tickets = db.scalars(select(Ticket).where(Ticket.epic_id.in_(epic_ids))).all() if epic_ids else []
    open_tickets = [ticket for ticket in tickets if ticket.status in OPEN_TICKET_STATUSES]
    overdue_questions = sum(1 for ticket in open_tickets if ticket.due_at and ticket.due_at < now)
    waiting_expert = sum(1 for ticket in open_tickets if ticket.status == TicketStatus.FORWARDED)
    issue_keys = sorted(jira_unique)
    jira_base = next((row.browser_url.split("/browse/")[0] for row in jira_unique.values() if "/browse/" in row.browser_url), None)
    jira_search_url = f"{jira_base}/issues/?jql={quote('issuekey in (' + ','.join(issue_keys) + ')')}" if jira_base and issue_keys else None

    return {
        "readiness": readiness,
        "actual_risks": actual,
        "warnings": warnings,
        "data_gaps": gaps,
        "attention": [*actual, *warnings, *gaps],
        "summary": {
            "epic_count": len(epics),
            "jira_task_count": len({item.jira_issue_key for item in jira_rows}),
            "open_questions": sum(_open_questions_count(db, epic.id) for epic in epics),
            "local_blockers": sum(1 for epic in epics for blocker in epic.blockers or [] if blocker.resolved_at is None),
            "risk_counts": counts,
            "qa": qa_counts,
            "jira": {"total": len(jira_unique), "by_status": jira_by_status, "by_priority": jira_by_priority, "by_type": jira_by_type},
            "questions": {"open": len(open_tickets), "overdue": overdue_questions, "waiting_expert": waiting_expert},
        },
        "current_test_runs": current_runs,
        "key_jira_tasks": [{"key": row.jira_issue_key, "title": row.summary, "status": row.status, "priority": row.priority, "url": row.browser_url} for row in list(jira_unique.values())[:8]],
        "key_questions": [{"id": row.id, "key": f"Q-{row.id:03d}", "title": row.title or row.description, "status": row.status.value, "overdue": bool(row.due_at and row.due_at < now), "url": f"/questions/Q-{row.id:03d}"} for row in open_tickets[:8]],
        "jira_search_url": jira_search_url,
    }


def kanban_freshness(db: Session) -> dict[str, Any]:
    setting = db.get(AppSetting, "kanban_analytics_snapshot")
    updated_at = setting.value_json.get("updated_at") if setting and isinstance(setting.value_json, dict) else None
    if not updated_at:
        return {"status": "data_unavailable", "updated_at": None}
    try:
        parsed = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return {"status": "data_unavailable", "updated_at": updated_at}
    stale = parsed < datetime.utcnow() - timedelta(hours=get_settings().release_external_data_stale_hours)
    return {"status": "stale" if stale else "fresh", "updated_at": updated_at}
