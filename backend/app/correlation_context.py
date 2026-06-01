"""Request-scoped correlation identifiers (W3C trace-style semantics, simplified)."""

from __future__ import annotations

from contextvars import ContextVar
from uuid import uuid4

_CORRELATION_ID: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_HTTP_REQUEST_ID: ContextVar[str | None] = ContextVar("http_request_id", default=None)


def set_correlation_context(*, correlation_id: str, http_request_id: str | None = None) -> None:
    _CORRELATION_ID.set(correlation_id)
    _HTTP_REQUEST_ID.set(http_request_id)


def clear_correlation_context() -> None:
    _CORRELATION_ID.set(None)
    _HTTP_REQUEST_ID.set(None)


def get_correlation_id() -> str | None:
    return _CORRELATION_ID.get()


def get_http_request_id() -> str | None:
    return _HTTP_REQUEST_ID.get()


def new_correlation_id() -> str:
    return str(uuid4())
