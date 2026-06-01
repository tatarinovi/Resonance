from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

from app.models import AppSetting
from app.routers.analytics import (
    _load_snapshot_refresh_state,
    _mark_snapshot_refresh_failed,
    _mark_snapshot_refresh_running,
    _mark_snapshot_refresh_success,
    _save_snapshot_refresh_state,
)


class FakeDb:
    def __init__(self):
        self.settings: dict[str, AppSetting] = {}

    def get(self, model, key):
        if model is AppSetting:
            return self.settings.get(key)
        return None

    def add(self, obj):
        if isinstance(obj, AppSetting):
            self.settings[obj.key] = obj

    def commit(self):
        pass

    def refresh(self, obj):
        pass


def _user():
    return SimpleNamespace(id=7, username="admin")


def test_refresh_state_running_success_flow():
    db = FakeDb()

    running = _mark_snapshot_refresh_running(db, _user(), "manual")

    assert running["status"] == "running"
    assert running["started_at"]
    assert running["started_by"] == {"source": "manual", "id": 7, "username": "admin"}

    success = _mark_snapshot_refresh_success(db)

    assert success["status"] == "success"
    assert success["finished_at"]
    assert success["error"] is None


def test_refresh_state_failed_flow():
    db = FakeDb()
    _mark_snapshot_refresh_running(db, _user(), "manual")

    failed = _mark_snapshot_refresh_failed(db, RuntimeError("boom"))

    assert failed["status"] == "failed"
    assert failed["finished_at"]
    assert failed["error"] == "boom"


def test_fresh_running_blocks_second_start():
    db = FakeDb()
    _mark_snapshot_refresh_running(db, _user(), "manual")

    try:
        _mark_snapshot_refresh_running(db, _user(), "manual")
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("Expected HTTPException")


def test_stale_running_is_marked_failed_and_allows_restart():
    db = FakeDb()
    stale_started_at = (datetime.utcnow() - timedelta(minutes=45)).isoformat() + "Z"
    _save_snapshot_refresh_state(
        db,
        {
            "status": "running",
            "started_at": stale_started_at,
            "finished_at": None,
            "started_by": {"source": "manual"},
            "error": None,
        },
    )

    stale = _load_snapshot_refresh_state(db)

    assert stale["status"] == "failed"
    assert stale["error"]

    running = _mark_snapshot_refresh_running(db, _user(), "manual")
    assert running["status"] == "running"
