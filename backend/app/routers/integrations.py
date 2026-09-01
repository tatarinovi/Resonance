"""Administrator-managed global connections to external systems."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import require_admin
from ..integration_service import (
    CHECK_STATUS_FAILED,
    CHECK_STATUS_SUCCESS,
    IntegrationInvariantError,
    decrypt_secret,
    encrypt_secret,
    get_connection,
    mark_check_result,
    reset_check_state,
    validate_endpoint,
)
from ..models import IntegrationConnection, User
from ..schemas import (
    IntegrationRead,
    JiraIntegrationPatch,
    KanbanConnectRequest,
    TestOpsIntegrationPatch,
)


router = APIRouter(prefix="/integrations", tags=["integrations"])


def _invariant_error() -> HTTPException:
    return HTTPException(status_code=500, detail="Integration configuration is inconsistent.")


def _connection_or_500(db: Session, kind: str) -> IntegrationConnection:
    try:
        return get_connection(db, kind)
    except IntegrationInvariantError as exc:
        raise _invariant_error() from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unsupported integration type.") from exc


def _read(item: IntegrationConnection) -> IntegrationRead:
    return IntegrationRead(
        type=item.integration_type,  # type: ignore[arg-type]
        endpoint=item.endpoint,
        auth_type=item.auth_type if item.auth_type in {"token", "basic"} else "token",  # type: ignore[arg-type]
        username=item.username,
        credentials_configured=item.encrypted_secret is not None,
        last_checked_at=item.last_checked_at,
        last_check_status=item.last_check_status,  # type: ignore[arg-type]
        last_check_error=item.last_check_error,
    )


def _validated_endpoint(value: str) -> str:
    try:
        return validate_endpoint(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _safe_upstream_failure(label: str, exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"{label}: external service returned HTTP {exc.response.status_code}."
    if isinstance(exc, httpx.TimeoutException):
        return f"{label}: connection timed out."
    if isinstance(exc, httpx.HTTPError):
        return f"{label}: external service is unavailable."
    return f"{label}: external service returned an invalid response."


def _existing_or_new_secret(item: IntegrationConnection, secret: str | None) -> bool:
    """Replace only with a non-empty value; null/empty means preserve."""
    if secret is None or not secret.strip():
        return item.encrypted_secret is not None
    item.encrypted_secret = encrypt_secret(secret)
    return True


def _require_endpoint(item: IntegrationConnection) -> str:
    if not item.endpoint:
        raise HTTPException(status_code=422, detail="Endpoint is required.")
    return item.endpoint


@router.get("", response_model=list[IntegrationRead])
def list_integrations(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[IntegrationRead]:
    return [_read(_connection_or_500(db, kind)) for kind in ("kanban", "jira", "testops")]


@router.patch("/jira", response_model=IntegrationRead)
def patch_jira(
    payload: JiraIntegrationPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> IntegrationRead:
    item = _connection_or_500(db, "jira")
    if "endpoint" in payload.model_fields_set:
        item.endpoint = _validated_endpoint(payload.endpoint or "")
    _require_endpoint(item)
    if "auth_type" in payload.model_fields_set:
        item.auth_type = payload.auth_type or "token"
    if "username" in payload.model_fields_set:
        item.username = (payload.username or "").strip() or None
    has_credential = _existing_or_new_secret(item, payload.secret)
    if item.auth_type == "basic" and not item.username:
        raise HTTPException(status_code=422, detail="Jira Basic authentication requires a username.")
    if not has_credential:
        raise HTTPException(status_code=422, detail="Jira credentials are required.")
    reset_check_state(item)
    db.commit()
    db.refresh(item)
    return _read(item)


@router.patch("/testops", response_model=IntegrationRead)
def patch_testops(
    payload: TestOpsIntegrationPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> IntegrationRead:
    item = _connection_or_500(db, "testops")
    if "endpoint" in payload.model_fields_set:
        item.endpoint = _validated_endpoint(payload.endpoint or "")
    _require_endpoint(item)
    item.auth_type = "token"
    item.username = None
    if not _existing_or_new_secret(item, payload.secret):
        raise HTTPException(status_code=422, detail="TestOps credentials are required.")
    reset_check_state(item)
    db.commit()
    db.refresh(item)
    return _read(item)


def _extract_kanban_token(response: httpx.Response) -> str:
    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Invalid Kanban credentials.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Kanban returned an invalid authorization response.") from exc
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        payload = payload["data"]
    token = payload if isinstance(payload, str) else (payload.get("token") or payload.get("access_token") if isinstance(payload, dict) else None)
    if not isinstance(token, str) or not token.strip():
        raise HTTPException(status_code=502, detail="Kanban returned an invalid authorization response.")
    return token.strip()


@router.post("/kanban/connect", response_model=IntegrationRead)
def connect_kanban(
    payload: KanbanConnectRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> IntegrationRead:
    endpoint = _validated_endpoint(payload.endpoint)
    email = payload.email.strip()
    if not email or not payload.password:
        raise HTTPException(status_code=422, detail="Kanban email and password are required.")
    timeout = get_settings().integration_connection_check_timeout_seconds
    try:
        with httpx.Client(timeout=timeout, headers={"Accept": "application/json"}) as client:
            response = client.post(f"{endpoint}/auth/token", params={"email": email, "password": payload.password})
        token = _extract_kanban_token(response)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=_safe_upstream_failure("Kanban", exc)) from None
    item = _connection_or_500(db, "kanban")
    item.endpoint = endpoint
    item.auth_type = "token"
    item.username = email
    item.encrypted_secret = encrypt_secret(token)
    reset_check_state(item)
    db.commit()
    db.refresh(item)
    return _read(item)


def _check_upstream(item: IntegrationConnection, secret: str) -> None:
    timeout = get_settings().integration_connection_check_timeout_seconds
    with httpx.Client(timeout=timeout, headers={"Accept": "application/json"}) as client:
        if item.integration_type == "kanban":
            response = client.get(f"{item.endpoint}/auth/user", headers={"Authorization": f"Bearer {secret}"})
        elif item.integration_type == "jira":
            if item.auth_type == "basic":
                response = client.get(f"{item.endpoint}/rest/api/2/myself", auth=(item.username or "", secret))
            else:
                response = client.get(f"{item.endpoint}/rest/api/2/myself", headers={"Authorization": f"Bearer {secret}"})
        else:
            response = client.get(f"{item.endpoint}/api/project", headers={"Authorization": f"Api-Token {secret}"})
        response.raise_for_status()
        try:
            response.json()
        except ValueError as exc:
            raise RuntimeError("invalid JSON") from exc


@router.post("/{integration_type}/check", response_model=IntegrationRead)
def check_integration(
    integration_type: Literal["kanban", "jira", "testops"],
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> IntegrationRead:
    item = _connection_or_500(db, integration_type)
    _require_endpoint(item)
    secret = decrypt_secret(db, item)
    try:
        _check_upstream(item, secret)
    except Exception as exc:
        mark_check_result(item, result=CHECK_STATUS_FAILED, error=_safe_upstream_failure(item.integration_type.title(), exc))
    else:
        mark_check_result(item, result=CHECK_STATUS_SUCCESS)
    db.commit()
    db.refresh(item)
    return _read(item)


@router.delete("/{integration_type}/credentials", status_code=status.HTTP_204_NO_CONTENT)
def delete_credentials(
    integration_type: Literal["kanban", "jira", "testops"],
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    item = _connection_or_500(db, integration_type)
    item.encrypted_secret = None
    reset_check_state(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
