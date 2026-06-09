from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace

from app.models import AppSetting
from app.routers import analytics


class FakeDb:
    def get(self, model, key):
        if model is AppSetting:
            return None
        return None

    def scalars(self, stmt):
        _ = stmt
        return SimpleNamespace(all=lambda: [])


class FakeKanbanClient:
    web_base_url = "https://kanban.example"

    def stages(self):
        return [{"id": 2, "name": "In progress"}]

    def projects(self):
        return [{"id": 1, "slug": "alpha", "name": "Alpha"}]

    def project_users(self, slug):
        assert slug == "alpha"
        return [{"id": 42, "name": "Ada", "surname": "Lovelace"}]

    def task(self, task_id):
        assert task_id == 100
        return {
            "id": 100,
            "name": "Epic A",
            "project": {"slug": "alpha"},
            "stage": {"id": 2},
            "epic_by": [
                {"id": 101, "name": "Child task", "stage": {"id": 2}},
            ],
        }

    def pooled_http(self):
        return nullcontext()

    def task_worklogs(self, task_id):
        if task_id == 101:
            return [
                {
                    "time": 90,
                    "user": {"id": 42, "name": "Ada", "surname": "Lovelace"},
                    "begin": "2026-06-01T09:00:00Z",
                    "comment": "Build",
                }
            ]
        return []

    def task_url(self, slug, task_id):
        return f"{self.web_base_url}/projects/{slug}/{task_id}"


def test_kanban_epic_charts_live_returns_built_detail(monkeypatch):
    monkeypatch.setattr(analytics, "_kanban_client_for_user", lambda user: FakeKanbanClient())

    result = analytics.kanban_epic_charts_live(
        100,
        project_slug="alpha",
        user=SimpleNamespace(id=1, username="admin", role=SimpleNamespace(value="admin"), kanban_token="token"),
        db=FakeDb(),
    )

    assert result["charts_ready"] is True
    assert result["epic"]["id"] == 100
    assert result["epic"]["local_meta"]["tracked_hours"] == 1.5
    assert result["summary"]["task_count"] == 1
    assert result["summary"]["tracked_hours"] == 1.5
    assert result["tasks"][0]["tracked_hours"] == 1.5
    assert result["workload"] == [{"user_name": "Ada Lovelace", "hours": 1.5}]
