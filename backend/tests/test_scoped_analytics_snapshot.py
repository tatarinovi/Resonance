from datetime import datetime, timedelta

from app.models import ScopedAnalyticsSnapshot
from app.routers.analytics import _scoped_status


def row(**values):
    defaults = dict(
        scope_hash="a" * 64,
        scope_type="kanban_epics",
        scope_json={},
        data_json=None,
        last_success_at=None,
        refresh_started_at=None,
        last_attempt_at=None,
        last_attempt_failed=False,
        error_message=None,
    )
    defaults.update(values)
    return ScopedAnalyticsSnapshot(**defaults)


def test_scoped_snapshot_status_precedence_and_ten_minute_ttl():
    now = datetime(2026, 9, 7, 12, 0)
    assert _scoped_status(row(last_success_at=now - timedelta(minutes=9, seconds=59)), now) == "fresh"
    assert _scoped_status(row(last_success_at=now - timedelta(minutes=10)), now) == "stale"
    assert _scoped_status(row(last_success_at=now, last_attempt_failed=True), now) == "failed"
    assert _scoped_status(row(last_attempt_failed=True), now) == "error"
    assert _scoped_status(row(last_success_at=now - timedelta(days=1), refresh_started_at=now), now) == "refreshing"
