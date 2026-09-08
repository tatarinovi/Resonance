"""Small synchronous Allure TestOps read adapter owned by Epic test runs."""
from __future__ import annotations

from datetime import datetime
import re
import time
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import get_settings
from .integration_service import IntegrationInvariantError, decrypt_secret, get_connection
from .models import (
    Epic,
    EpicExternalSyncState,
    EpicTestOpsProblemCase,
    EpicTestOpsSnapshot,
    EpicTestRun,
)


PROBLEM_STATUSES = {"failed", "broken", "blocked"}


def parse_testops_launch_id(url: str | None) -> str | None:
    match = re.search(r"/launch/(\d+)(?:[/?#]|$)", str(url or ""), re.IGNORECASE)
    return match.group(1) if match else None


def _items(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("content", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _status(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("name") or value.get("value")
    return str(value or "unknown").strip().lower()


def fetch_testops_run(
    db: Session,
    run: EpicTestRun,
    *,
    timeout_seconds: int | None = None,
    deadline: float | None = None,
) -> dict:
    launch_id = (run.testops_launch_id or parse_testops_launch_id(run.url) or "").strip()
    if not launch_id:
        raise HTTPException(status_code=409, detail="TestOps launch is not configured for this test run.")
    try:
        connection = get_connection(db, "testops")
    except IntegrationInvariantError:
        raise HTTPException(status_code=500, detail="Integration configuration is inconsistent.") from None
    if not connection.endpoint:
        raise HTTPException(status_code=409, detail="TestOps integration is not configured.")
    secret = decrypt_secret(db, connection)
    timeout = timeout_seconds or get_settings().release_refresh_request_timeout_seconds
    headers = {"Authorization": f"Api-Token {secret}", "Accept": "application/json"}
    try:
        with httpx.Client(headers=headers) as client:
            remaining = deadline - time.monotonic() if deadline is not None else None
            if remaining is not None and remaining <= 0:
                raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Release refresh wall-clock budget exceeded.")
            launch_response = client.get(
                f"{connection.endpoint}/api/rs/launch/{launch_id}",
                timeout=min(float(timeout), remaining) if remaining is not None else timeout,
            )
            launch_response.raise_for_status()
            launch = launch_response.json()
            remaining = deadline - time.monotonic() if deadline is not None else None
            if remaining is not None and remaining <= 0:
                raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Release refresh wall-clock budget exceeded.")
            results: list[dict] = []
            page = 0
            page_size = 250
            while True:
                remaining = deadline - time.monotonic() if deadline is not None else None
                if remaining is not None and remaining <= 0:
                    raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Release refresh wall-clock budget exceeded.")
                results_response = client.get(
                    f"{connection.endpoint}/api/rs/testresult",
                    params={"launchId": launch_id, "page": page, "size": page_size},
                    timeout=min(float(timeout), remaining) if remaining is not None else timeout,
                )
                results_response.raise_for_status()
                payload = results_response.json()
                batch = _items(payload)
                results.extend(batch)
                if len(batch) < page_size or (isinstance(payload, dict) and payload.get("last") is True):
                    break
                page += 1
    except httpx.TimeoutException:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="TestOps request timed out.") from None
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"TestOps returned HTTP {exc.response.status_code}.") from None
    except httpx.HTTPError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TestOps is unavailable.") from None
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TestOps returned an invalid response.") from None

    counts = {key: 0 for key in ("passed", "failed", "broken", "blocked", "in_progress")}
    cases: list[dict] = []
    for item in results:
        item_status = _status(item.get("status"))
        normalized = "in_progress" if item_status in {"in progress", "inprogress", "running"} else item_status
        if normalized in counts:
            counts[normalized] += 1
        if normalized in PROBLEM_STATUSES:
            supplied_url = str(item.get("url") or "")
            result_url = urljoin(connection.endpoint + "/", supplied_url)
            direct = bool(supplied_url and urlsplit(result_url).scheme in {"http", "https"} and urlsplit(result_url).netloc == urlsplit(connection.endpoint).netloc)
            raw_parameters = item.get("parameters")
            parameters = {str(p.get("name"))[:100]: str(p.get("value"))[:500] for p in raw_parameters if isinstance(p, dict)} if isinstance(raw_parameters, list) else None
            cases.append({
                "external_result_id": str(item["id"])[:128] if item.get("id") is not None else None,
                "parameters": parameters,
                "link_kind": "result" if direct else "launch",
                "case_name": str(item.get("name") or item.get("fullName") or item.get("title") or "Test result")[:2000],
                "status": normalized,
                "safe_comment": str(item.get("message") or item.get("statusDetails") or "")[:2000] or None,
                "external_url": result_url if direct else f"{connection.endpoint}/launch/{launch_id}",
                "defect_key": str(item.get("defectKey") or "")[:128] or None,
            })
    launch_status = _status(launch.get("status") if isinstance(launch, dict) else None)
    return {
        "external_launch_id": launch_id,
        "status": launch_status,
        "total": len(results),
        **counts,
        "problem_cases": cases,
    }


def _state(db: Session, epic_id: int) -> EpicExternalSyncState:
    state = db.scalar(select(EpicExternalSyncState).where(
        EpicExternalSyncState.epic_id == epic_id,
        EpicExternalSyncState.source == "testops",
    ))
    if state is None:
        state = EpicExternalSyncState(epic_id=epic_id, source="testops")
        db.add(state)
    return state


def replace_testops_snapshot(db: Session, run: EpicTestRun, data: dict) -> datetime:
    synced_at = datetime.utcnow()
    db.execute(delete(EpicTestOpsProblemCase).where(EpicTestOpsProblemCase.test_run_id == run.id))
    db.execute(delete(EpicTestOpsSnapshot).where(EpicTestOpsSnapshot.test_run_id == run.id))
    cases = list(data.get("problem_cases") or [])
    snapshot = EpicTestOpsSnapshot(
        test_run_id=run.id,
        external_launch_id=str(data["external_launch_id"]),
        status=str(data.get("status") or "unknown"),
        total=int(data.get("total") or 0),
        passed=int(data.get("passed") or 0),
        failed=int(data.get("failed") or 0),
        broken=int(data.get("broken") or 0),
        blocked=int(data.get("blocked") or 0),
        in_progress=int(data.get("in_progress") or 0),
        synced_at=synced_at,
    )
    db.add(snapshot)
    db.flush()
    db.add_all(EpicTestOpsProblemCase(test_run_id=run.id, **case) for case in cases)
    run.sync_attempt_at = synced_at
    run.sync_error = None
    run.testops_launch_id = str(data["external_launch_id"])
    state = _state(db, run.epic_id)
    state.last_attempt_at = synced_at
    state.last_success_at = synced_at
    state.last_error_code = None
    state.last_error_message = None
    state.item_count = int(data.get("total") or 0)
    db.commit()
    return synced_at


def mark_testops_refresh_failure(db: Session, epic_id: int, code: str, message: str) -> None:
    state = _state(db, epic_id)
    state.last_attempt_at = datetime.utcnow()
    state.last_error_code = code[:64]
    state.last_error_message = message[:500]
    db.commit()


def refresh_epic_testops(db: Session, epic: Epic) -> int:
    refreshed = 0
    for run in epic.test_runs or []:
        if not (run.testops_launch_id or parse_testops_launch_id(run.url)):
            continue
        data = fetch_testops_run(db, run)
        replace_testops_snapshot(db, run, data)
        refreshed += 1
    return refreshed


def problem_case_read(case):
    return {"id": case.id, "external_result_id": case.external_result_id,
            "title": case.case_name, "status": case.status, "comment": case.safe_comment,
            "url": case.external_url, "defect_key": case.defect_key,
            "parameters": case.parameters, "link_kind": case.link_kind}


def snapshot_read(snapshot, cases=None):
    if snapshot is None:
        return None
    return {**{key: getattr(snapshot, key) for key in ('status', 'total', 'passed', 'failed', 'broken', 'blocked', 'in_progress', 'synced_at')},
            'external_launch_id': snapshot.external_launch_id,
            'problem_cases': [problem_case_read(case) for case in (cases or [])]}
