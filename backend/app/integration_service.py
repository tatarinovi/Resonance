"""Global external-integration credentials and safe connection helpers."""
from __future__ import annotations

from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import IntegrationConnection


SUPPORTED_INTEGRATION_TYPES = ("kanban", "jira", "testops")
CHECK_STATUS_NEVER = "never"
CHECK_STATUS_SUCCESS = "success"
CHECK_STATUS_FAILED = "failed"
CHECK_STATUS_CREDENTIAL_UNREADABLE = "credential_unreadable"


class IntegrationInvariantError(RuntimeError):
    """The migration-created integration rows were manually damaged."""


def validate_endpoint(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError("Endpoint is required.")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Endpoint must be an absolute HTTP(S) URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Endpoint must not contain embedded credentials.")
    if parsed.query or parsed.fragment:
        raise ValueError("Endpoint must not contain query or fragment.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def get_connection(db: Session, integration_type: str) -> IntegrationConnection:
    if integration_type not in SUPPORTED_INTEGRATION_TYPES:
        raise ValueError("Unsupported integration type.")
    rows = list(
        db.scalars(
            select(IntegrationConnection).where(IntegrationConnection.integration_type == integration_type)
        ).all()
    )
    if len(rows) != 1:
        raise IntegrationInvariantError("Expected exactly one configured integration row.")
    return rows[0]


def _fernet() -> Fernet:
    return Fernet(get_settings().integration_credentials_fernet_key.encode("utf-8"))


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("ascii")


def reset_check_state(connection: IntegrationConnection) -> None:
    connection.last_checked_at = None
    connection.last_check_status = CHECK_STATUS_NEVER
    connection.last_check_error = None


def mark_check_result(connection: IntegrationConnection, *, result: str, error: str | None = None) -> None:
    connection.last_checked_at = datetime.utcnow()
    connection.last_check_status = result
    connection.last_check_error = error


def decrypt_secret(db: Session, connection: IntegrationConnection) -> str:
    if not connection.encrypted_secret:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Credentials are not configured.")
    try:
        return _fernet().decrypt(connection.encrypted_secret.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError):
        mark_check_result(
            connection,
            result=CHECK_STATUS_CREDENTIAL_UNREADABLE,
            error="Saved credential cannot be decrypted. Reconnect this integration.",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Saved credentials must be reconfigured.",
        ) from None


def require_global_kanban_token(db: Session) -> str:
    connection = get_connection(db, "kanban")
    return decrypt_secret(db, connection)


def optional_global_kanban_token(db: Session) -> str | None:
    """Return None for an unconfigured/unreadable global Kanban connection.

    Scheduler-style callers should skip work rather than emitting repeated exceptions.
    """
    connection = get_connection(db, "kanban")
    if not connection.encrypted_secret:
        return None
    try:
        return _fernet().decrypt(connection.encrypted_secret.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError):
        mark_check_result(
            connection,
            result=CHECK_STATUS_CREDENTIAL_UNREADABLE,
            error="Saved credential cannot be decrypted. Reconnect this integration.",
        )
        db.commit()
        return None
