from __future__ import annotations

from fastapi import HTTPException

from app.routers.analytics import (
    _kanban_daily_summary_from_snapshot,
    _worklog_matches_day_user,
)


def test_worklog_matches_day_and_user():
    row = {"begin": "2026-05-13T10:15:00Z", "kanban_user_id": 42}

    assert _worklog_matches_day_user(row, "2026-05-13", 42)
    assert not _worklog_matches_day_user(row, "2026-05-12", 42)
    assert not _worklog_matches_day_user(row, "2026-05-13", 7)


def test_daily_summary_includes_epic_and_standalone_tasks():
    snapshot = {
        "current_user": {"id": 42, "name": "Ada"},
        "epic_details": {
            "alpha:100": {
                "epic": {
                    "id": 100,
                    "name": "Epic A",
                    "project": {"id": 1, "slug": "alpha", "name": "Alpha"},
                    "url": "https://kanban/projects/alpha/100",
                },
                "tasks": [
                    {
                        "id": 101,
                        "name": "Epic child",
                        "project": {"id": 1, "slug": "alpha", "name": "Alpha"},
                        "url": "https://kanban/projects/alpha/101",
                    }
                ],
                "worklogs": [
                    {
                        "task_id": 101,
                        "task_name": "Epic child",
                        "task_url": "https://kanban/projects/alpha/101",
                        "user_name": "Ada",
                        "kanban_user_id": 42,
                        "minutes": 90,
                        "hours": 1.5,
                        "comment": "Build",
                        "begin": "2026-05-13T09:00:00Z",
                    },
                    {
                        "task_id": 101,
                        "task_name": "Epic child",
                        "task_url": "https://kanban/projects/alpha/101",
                        "user_name": "Grace",
                        "kanban_user_id": 7,
                        "minutes": 30,
                        "hours": 0.5,
                        "comment": "Other user",
                        "begin": "2026-05-13T09:30:00Z",
                    },
                ],
            }
        },
        "task_standalone_details": {
            "alpha:201": {
                "task": {
                    "id": 201,
                    "name": "Standalone",
                    "project": {"id": 1, "slug": "alpha", "name": "Alpha"},
                    "url": "https://kanban/projects/alpha/201",
                },
                "worklogs": [
                    {
                        "task_id": 201,
                        "task_name": "Standalone",
                        "task_url": "https://kanban/projects/alpha/201",
                        "user_name": "Ada",
                        "kanban_user_id": 42,
                        "minutes": 45,
                        "hours": 0.75,
                        "comment": "Standalone work",
                        "begin": "2026-05-13T11:00:00Z",
                    }
                ],
            }
        },
    }

    result = _kanban_daily_summary_from_snapshot(snapshot, "2026-05-13")

    assert result["kanban_user"] == {"id": 42, "name": "Ada"}
    assert result["summary"]["total_minutes"] == 135
    assert result["summary"]["worklogs"] == 2
    project = result["projects"][0]
    assert project["project"]["slug"] == "alpha"
    assert project["epics"][0]["tasks"][0]["task"]["id"] == 101
    assert project["without_epic"]["tasks"][0]["task"]["id"] == 201


def test_daily_summary_empty_day():
    snapshot = {
        "current_user": {"id": 42, "name": "Ada"},
        "epic_details": {},
        "task_standalone_details": {},
    }

    result = _kanban_daily_summary_from_snapshot(snapshot, "2026-05-13")

    assert result["projects"] == []
    assert result["summary"]["total_minutes"] == 0


def test_daily_summary_requires_user():
    try:
        _kanban_daily_summary_from_snapshot({"current_user": {}}, "2026-05-13")
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected HTTPException")
