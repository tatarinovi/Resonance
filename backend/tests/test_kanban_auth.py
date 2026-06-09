from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.routers.auth import _extract_kanban_auth_token


def test_extract_kanban_auth_token_accepts_token() -> None:
    response = httpx.Response(200, json={"token": "kanban-token"})

    assert _extract_kanban_auth_token(response) == "kanban-token"


def test_extract_kanban_auth_token_rejects_non_json_success() -> None:
    response = httpx.Response(200, content=b"<html>login</html>")

    with pytest.raises(HTTPException) as exc_info:
        _extract_kanban_auth_token(response)

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Unexpected Kanban auth response."


def test_extract_kanban_auth_token_rejects_empty_success() -> None:
    response = httpx.Response(200, content=b"")

    with pytest.raises(HTTPException) as exc_info:
        _extract_kanban_auth_token(response)

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Unexpected Kanban auth response."
