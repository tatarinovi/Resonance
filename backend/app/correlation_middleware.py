"""Populate correlation_id per HTTP request from header or generate a new UUID."""

from __future__ import annotations

from uuid import UUID

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .correlation_context import new_correlation_id, set_correlation_context


CORRELATION_HEADER = "X-Correlation-ID"


class CorrelationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        from .correlation_context import clear_correlation_context

        raw = request.headers.get(CORRELATION_HEADER)
        cid: str
        if raw:
            s = raw.strip()
            try:
                cid = str(UUID(s))
            except ValueError:
                cid = s[:80] if len(s) > 80 else s
        else:
            cid = new_correlation_id()
        rid = request.headers.get("X-Request-ID") or request.headers.get("x-request-id")
        set_correlation_context(correlation_id=cid, http_request_id=rid.strip()[:120] if rid else None)
        try:
            response = await call_next(request)
            response.headers[CORRELATION_HEADER] = cid
            return response
        finally:
            clear_correlation_context()
