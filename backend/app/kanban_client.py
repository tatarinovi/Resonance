from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .config import get_settings


settings = get_settings()

# HTTP paths and payloads follow DS Kanban OpenAPI: `helps/v1.json` (DS KANBAN API v1.0.0).


def _kanban_data(payload: dict | list) -> dict | list:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _to_iso_date(value: str | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt.isoformat()


def parse_kanban_reference(kanban_url: str) -> tuple[str, int]:
    path_parts = [part for part in urlparse(kanban_url).path.split("/") if part]
    for index, part in enumerate(path_parts):
        if part in {"projects", "project"} and index + 2 < len(path_parts) and path_parts[index + 2].isdigit():
            return path_parts[index + 1], int(path_parts[index + 2])

    numeric_parts = [(index, part) for index, part in enumerate(path_parts) if part.isdigit()]
    if numeric_parts:
        index, value = numeric_parts[-1]
        slug = path_parts[index - 1] if index > 0 else ""
        if slug:
            return slug, int(value)

    raise ValueError("Kanban URL must contain a project slug and task id.")


@dataclass
class KanbanClient:
    token: str
    _pooled_http: httpx.Client | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if not self.token:
            raise HTTPException(status_code=503, detail="Kanban token is not configured for this user.")
        self.base_url = settings.kanban_api_base_url.rstrip("/")
        self.web_base_url = self.base_url[:-4] if self.base_url.endswith("/api") else self.base_url

    def _auth_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }

    @contextmanager
    def pooled_http(self):
        """Один keep-alive клиент на серию запросов (например пагинация задач в bundle)."""
        if self._pooled_http is not None:
            raise RuntimeError("Nested pooled_http is not supported")
        with httpx.Client(
            timeout=settings.kanban_timeout_seconds,
            headers=self._auth_headers(),
        ) as c:
            self._pooled_http = c
            try:
                yield
            finally:
                self._pooled_http = None

    def _request(self, path: str, params: list[tuple[str, str]] | None = None) -> dict | list:
        return self._request_json("GET", path, params=params, json_body=None)

    def _parse_kanban_response(self, response: httpx.Response) -> Any:
        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Kanban token is invalid or expired.")
        if response.status_code >= 400:
            detail = response.text
            try:
                parsed = response.json()
                if isinstance(parsed, dict):
                    detail = str(parsed.get("message") or parsed.get("error") or parsed.get("detail") or parsed)[:800]
            except ValueError:
                pass
            hint = ""
            if response.status_code == 403:
                hint = (
                    " Обычно это значит, что у аккаунта Kanban нет права на эту операцию в DS "
                    "(не участник проекта/задачи, роль только на чтение и т.п.). "
                    "Войдите в Kanban тем же пользователем, которому выдан доступ в проекте, и переподключите токен."
                )
            raise HTTPException(
                status_code=502 if response.status_code >= 500 else response.status_code,
                detail=f"Kanban API error ({response.status_code}): {detail}{hint}",
            )
        if response.status_code == 204 or not (response.content or b"").strip():
            return None
        try:
            payload = response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Kanban API returned invalid JSON.") from exc
        return _kanban_data(payload)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: list[tuple[str, str]] | None = None,
        json_body: Any | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        pooled = self._pooled_http
        try:
            if pooled is not None:
                response = pooled.request(method, url, params=params, json=json_body)
            else:
                with httpx.Client(
                    timeout=settings.kanban_timeout_seconds,
                    headers=self._auth_headers(),
                ) as client:
                    response = client.request(method, url, params=params, json=json_body)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Kanban API request failed: {exc}") from exc

        return self._parse_kanban_response(response)

    def get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict | list:
        result = self._request_json("GET", path, params=params, json_body=None)
        return result if isinstance(result, (dict, list)) else {}

    def current_user(self) -> dict[str, Any]:
        payload = self.get("/auth/user")
        return payload if isinstance(payload, dict) else {}

    def user_tasks_legacy(self, kanban_user_id: int) -> list[dict[str, Any]]:
        """GET /user/{id}/task/legacy — «мои задачи» по всем проектам (см. helps/v1.json)."""
        path = f"/user/{int(kanban_user_id)}/task/legacy"
        payload = self.get(path)
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        return []

    def stages(self) -> list[dict[str, Any]]:
        payload = self.get("/stage")
        return payload if isinstance(payload, list) else []

    def projects(self) -> list[dict[str, Any]]:
        payload = self.get("/project")
        projects = payload if isinstance(payload, list) else []
        return [item for item in projects if not item.get("is_archived") and item.get("is_archived") != 1]

    def project_users(self, slug: str) -> list[dict[str, Any]]:
        """GET /project/{slug}/user — участники проекта (см. v1.json)."""
        payload = self.get(f"/project/{slug}/user")
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            inner = payload.get("data")
            if isinstance(inner, list):
                return inner
            users = payload.get("users") or payload.get("members") or []
            return users if isinstance(users, list) else []
        return []

    def project_list(self, slug: str, params: list[tuple[str, str]]) -> list[dict[str, Any]]:
        """GET /project/{slug}/list — список вне канбан-контекста (пагинация count/page)."""
        payload = self.get(f"/project/{slug}/list", params=params)
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            inner = payload.get("data")
            if isinstance(inner, list):
                return inner
        return []

    def project_epics_catalog(self, slug: str) -> list[dict[str, Any]]:
        """Эпики проекта: GET /project/{slug}/list + filter[type_id][5] (см. analytics snapshot)."""
        params = [("filter[type_id][5]", "5")]
        return self.project_list_all(slug, params=params)

    def project_list_all(self, slug: str, params: list[tuple[str, str]], page_size: int = 100) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1

        while True:
            paged_params = [*params, ("count", str(page_size)), ("page", str(page))]
            batch = self.project_list(slug, paged_params)
            if not batch:
                break
            items.extend(batch)
            if len(batch) < page_size:
                break
            page += 1

        return items

    def project_board_task_list(self, slug: str, params: list[tuple[str, str]]) -> list[dict[str, Any]]:
        """GET /project/{slug}/task — список задач проекта для канбана (см. v1.json)."""
        payload = self.get(f"/project/{slug}/task", params=params)
        return payload if isinstance(payload, list) else []

    def project_board_task_list_all(
        self,
        slug: str,
        params: list[tuple[str, str]],
        page_size: int | None = None,
    ) -> list[dict[str, Any]]:
        if page_size is None:
            page_size = settings.kanban_bundle_task_page_size
        items: list[dict[str, Any]] = []
        page = 1
        while True:
            paged_params = [*params, ("count", str(page_size)), ("page", str(page))]
            batch = self.project_board_task_list(slug, paged_params)
            if not batch:
                break
            items.extend(batch)
            if len(batch) < page_size:
                break
            page += 1
        return items

    def task(self, task_id: int) -> dict[str, Any]:
        payload = self.get(f"/task/{task_id}")
        return payload if isinstance(payload, dict) else {}

    def task_worklogs(self, task_id: int) -> list[dict[str, Any]]:
        """GET /task/{id}/work — в OpenAPI ответ обёрнут в `{ \"data\": Work[] }` (helps/v1.json)."""
        payload = self.get(f"/task/{task_id}/work")
        inner = _kanban_data(payload) if isinstance(payload, dict) else payload
        return inner if isinstance(inner, list) else []

    def project_detail(self, slug: str) -> dict[str, Any]:
        payload = self.get(f"/project/{slug}")
        return payload if isinstance(payload, dict) else {}

    def task_types(self) -> list[dict[str, Any]]:
        payload = self.get("/task_type")
        return payload if isinstance(payload, list) else []

    def priorities(self) -> list[dict[str, Any]]:
        payload = self.get("/priority")
        return payload if isinstance(payload, list) else []

    def components(self) -> list[dict[str, Any]]:
        payload = self.get("/component")
        return payload if isinstance(payload, list) else []

    def patch_task(self, task_id: int, body: dict[str, Any]) -> Any:
        return self._request_json("PATCH", f"/task/{task_id}", json_body=body)

    def post_project_task(self, slug: str, body: dict[str, Any]) -> Any:
        return self._request_json("POST", f"/project/{slug}/task", json_body=body)

    def task_comments(self, task_id: int) -> list[dict[str, Any]]:
        payload = self.get(f"/task/{task_id}/comment")
        return payload if isinstance(payload, list) else []

    def post_task_comment(self, task_id: int, body: dict[str, Any]) -> Any:
        return self._request_json("POST", f"/task/{task_id}/comment", json_body=body)

    def post_task_work(self, task_id: int, body: dict[str, Any] | None) -> Any:
        return self._request_json("POST", f"/task/{task_id}/work", json_body=body)

    def post_task_estimate(self, task_id: int, body: dict[str, Any]) -> Any:
        return self._request_json("POST", f"/task-estimate/{task_id}", json_body=body)

    def post_task_checklist(self, task_id: int, body: dict[str, Any]) -> Any:
        return self._request_json("POST", f"/task-check-item/task/{task_id}", json_body=body)

    def patch_checklist_point(self, point_id: int, body: dict[str, Any]) -> Any:
        return self._request_json("PATCH", f"/task-check-item/update/{point_id}", json_body=body)

    def task_url(self, project_slug: str, task_id: int) -> str:
        return f"{self.web_base_url}/projects/{project_slug}/{task_id}"


def normalize_person(person: Any) -> str | None:
    if not isinstance(person, dict):
        return None
    parts = [str(person.get("name") or "").strip(), str(person.get("surname") or "").strip()]
    full_name = " ".join(part for part in parts if part)
    return full_name or str(person.get("username") or person.get("email") or "").strip() or None


def normalize_stage(task: dict[str, Any], stages_map: dict[int, dict[str, Any]]) -> dict[str, Any]:
    stage = task.get("stage")
    stage_id = stage.get("id") if isinstance(stage, dict) else stage
    # Do not fall back to task["status"]: in Kanban API it is often a workflow code (1 Новая, 2 …),
    # not a board stage id — using it here broke column/status for every task.
    stage_id = stage_id or task.get("stage_id") or task.get("status_id")
    try:
        stage_id = int(stage_id)
    except (TypeError, ValueError):
        stage_id = 0
    meta = stages_map.get(stage_id) or {}
    return {
        "id": stage_id,
        "name": meta.get("name") or task.get("stage_name") or task.get("status_name") or "Unknown",
    }


def normalize_assignees(task: dict[str, Any], project_users: list[dict[str, Any]]) -> list[str]:
    project_user_map = {user.get("id"): user for user in project_users if isinstance(user, dict)}
    assignees = task.get("assignees") or task.get("users") or []
    names: list[str] = []
    for item in assignees:
        if isinstance(item, dict):
            name = normalize_person(item)
            if name:
                names.append(name)
                continue
            user_id = item.get("id") or item.get("user_id")
            mapped = project_user_map.get(user_id)
            mapped_name = normalize_person(mapped)
            if mapped_name:
                names.append(mapped_name)
        else:
            mapped = project_user_map.get(item)
            mapped_name = normalize_person(mapped)
            if mapped_name:
                names.append(mapped_name)

    if not names and isinstance(task.get("responsible"), dict):
        responsible_name = normalize_person(task["responsible"])
        if responsible_name:
            names.append(responsible_name)
    return names


def normalize_task(
    task: dict[str, Any],
    project: dict[str, Any],
    stages_map: dict[int, dict[str, Any]],
    project_users: list[dict[str, Any]],
    web_base_url: str,
) -> dict[str, Any]:
    stage = normalize_stage(task, stages_map)
    assignees = normalize_assignees(task, project_users)
    tracked_seconds = int(task.get("time_spent") or task.get("time_tracked") or task.get("spent_time") or task.get("logged_time") or 0)
    priority = task.get("priority")
    priority_id = priority.get("id") if isinstance(priority, dict) else priority or task.get("priority_id")
    priority_name = priority.get("name") if isinstance(priority, dict) else None

    return {
        "id": task.get("id"),
        "name": task.get("name") or task.get("title") or "",
        "project": {
            "id": project.get("id"),
            "slug": project.get("slug"),
            "name": project.get("name"),
        },
        "stage": stage,
        "priority": {
            "id": priority_id,
            "name": priority_name or "Unknown",
        },
        "deadline": task.get("deadline") or task.get("deadline_date") or task.get("due_date"),
        "assignees": assignees,
        "tracked_hours": round(tracked_seconds / 3600, 2),
        "is_super_task": bool(task.get("super_task") or task.get("is_super_task")),
        "created_at": _to_iso_date(task.get("created_at")),
        "updated_at": _to_iso_date(task.get("updated_at")),
        "url": f"{web_base_url}/projects/{project.get('slug')}/{task.get('id')}",
    }
