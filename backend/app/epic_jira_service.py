"""Small, synchronous Jira refresh for the task list of one Epic."""
from __future__ import annotations

from datetime import datetime
import time

import httpx
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import get_settings
from .integration_service import IntegrationInvariantError, decrypt_secret, get_connection
from .models import Epic, EpicExternalSyncState, EpicJiraIssue


def fetch_jira_issues(
    db: Session,
    epic: Epic,
    *,
    timeout_seconds: int | None = None,
    deadline: float | None = None,
) -> list[dict]:
    if not (epic.jira_jql or "").strip():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Jira JQL is not configured for this epic.")
    try:
        connection = get_connection(db, "jira")
    except IntegrationInvariantError:
        raise HTTPException(status_code=500, detail="Integration configuration is inconsistent.") from None
    if not connection.endpoint:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Jira integration is not configured.")

    secret = decrypt_secret(db, connection)
    settings = get_settings()
    headers = {"Authorization": f"Bearer {secret}"} if connection.auth_type != "basic" else {}
    auth = (connection.username or "", secret) if connection.auth_type == "basic" else None
    rows: list[dict] = []
    start = 0
    try:
        request_timeout = timeout_seconds or settings.epic_jira_refresh_timeout_seconds
        with httpx.Client(headers=headers, auth=auth) as client:
            while True:
                remaining = deadline - time.monotonic() if deadline is not None else None
                if remaining is not None and remaining <= 0:
                    raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Release refresh wall-clock budget exceeded.")
                response = client.get(
                    f"{connection.endpoint}/rest/api/2/search",
                    params={
                        "jql": epic.jira_jql,
                        "startAt": start,
                        "maxResults": settings.epic_jira_page_size,
                        "fields": "summary,status,priority,assignee,issuetype",
                    },
                    timeout=min(float(request_timeout), remaining) if remaining is not None else request_timeout,
                )
                response.raise_for_status()
                payload = response.json()
                batch = payload.get("issues") if isinstance(payload, dict) else None
                if not isinstance(batch, list):
                    raise ValueError("invalid Jira payload")
                rows.extend(item for item in batch if isinstance(item, dict))
                if len(rows) > settings.epic_jira_max_issues:
                    raise ValueError("Jira issue limit exceeded")
                start += len(batch)
                if not batch or start >= int(payload.get("total", start)):
                    break
    except httpx.TimeoutException:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Jira request timed out.") from None
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Jira returned HTTP {exc.response.status_code}.") from None
    except httpx.HTTPError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Jira is unavailable.") from None
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Jira returned an invalid response.") from None

    issues: list[dict] = []
    for row in rows:
        fields = row.get("fields") or {}
        key = str(row.get("key") or "").strip()
        if not key or not isinstance(fields, dict):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Jira returned an invalid response.")
        priority = fields.get("priority") if isinstance(fields.get("priority"), dict) else {}
        issue_type = fields.get("issuetype") if isinstance(fields.get("issuetype"), dict) else {}
        assignee = fields.get("assignee") if isinstance(fields.get("assignee"), dict) else {}
        issue_status = fields.get("status") if isinstance(fields.get("status"), dict) else {}
        issues.append({
            "jira_issue_key": key,
            "summary": str(fields.get("summary") or ""),
            "status": str(issue_status.get("name") or "Unknown"),
            "status_category": str((issue_status.get("statusCategory") or {}).get("key") or "") or None,
            "priority": str(priority.get("name") or "") or None,
            "assignee_display_name": str(assignee.get("displayName") or "") or None,
            "issue_type": str(issue_type.get("name") or "") or None,
            "browser_url": f"{connection.endpoint}/browse/{key}",
        })
    return issues


def _sync_state(db: Session, epic_id: int) -> EpicExternalSyncState:
    state = db.scalar(select(EpicExternalSyncState).where(
        EpicExternalSyncState.epic_id == epic_id,
        EpicExternalSyncState.source == "jira",
    ))
    if state is None:
        state = EpicExternalSyncState(epic_id=epic_id, source="jira")
        db.add(state)
    return state


def replace_jira_issues(db: Session, epic: Epic, rows: list[dict]) -> datetime:
    refreshed_at = datetime.utcnow()
    issues = [EpicJiraIssue(epic_id=epic.id, refreshed_at=refreshed_at, **row) for row in rows]

    db.execute(delete(EpicJiraIssue).where(EpicJiraIssue.epic_id == epic.id))
    db.add_all(issues)
    state = _sync_state(db, epic.id)
    state.last_attempt_at = refreshed_at
    state.last_success_at = refreshed_at
    state.last_error_code = None
    state.last_error_message = None
    state.item_count = len(issues)
    db.commit()
    return refreshed_at


def mark_jira_refresh_failure(db: Session, epic_id: int, code: str, message: str) -> None:
    state = _sync_state(db, epic_id)
    state.last_attempt_at = datetime.utcnow()
    state.last_error_code = code[:64]
    state.last_error_message = message[:500]
    db.commit()


def refresh_jira_issues(db: Session, epic: Epic) -> None:
    rows = fetch_jira_issues(db, epic)
    replace_jira_issues(db, epic, rows)
