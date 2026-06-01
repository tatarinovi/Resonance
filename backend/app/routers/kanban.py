from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import require_admin
from ..kanban_client import KanbanClient, normalize_person
from ..kanban_member_roles import (
    KanbanProjectMemberRole,
    MemberRolesPutBody,
    effective_role,
    has_explicit_role,
    load_project_role_map,
    save_project_role_map,
)
from ..models import User
from ..schemas import KanbanProjectRead

router = APIRouter(prefix="/kanban", tags=["kanban"])
# Прокси сверяется с DS Kanban OpenAPI: helps/v1.json

_bundle_cache: dict[tuple[int, str, bool], tuple[float, dict[str, Any]]] = {}
_bundle_cache_lock = threading.Lock()


def _bundle_cache_get(user_id: int, slug: str, only_mine: bool) -> dict[str, Any] | None:
    ttl = get_settings().kanban_bundle_cache_ttl_seconds
    if ttl <= 0:
        return None
    key = (user_id, slug, only_mine)
    now = time.monotonic()
    with _bundle_cache_lock:
        entry = _bundle_cache.get(key)
        if not entry:
            return None
        expires_at, body = entry
        if now > expires_at:
            del _bundle_cache[key]
            return None
        return body


def _bundle_cache_set(user_id: int, slug: str, only_mine: bool, body: dict[str, Any]) -> None:
    ttl = get_settings().kanban_bundle_cache_ttl_seconds
    if ttl <= 0:
        return
    key = (user_id, slug, only_mine)
    with _bundle_cache_lock:
        _bundle_cache[key] = (time.monotonic() + ttl, body)


def _bundle_cache_invalidate_for_user(user_id: int) -> None:
    """Сброс кэша бандла после мутаций задач: иначе refetch доски отдаёт старый список до TTL."""
    with _bundle_cache_lock:
        for key in [k for k in _bundle_cache if k[0] == user_id]:
            del _bundle_cache[key]


def _bundle_cache_invalidate_project(user_id: int, slug: str) -> None:
    with _bundle_cache_lock:
        for only_mine in (False, True):
            _bundle_cache.pop((user_id, slug, only_mine), None)


def _kanban_project_users_standalone(token: str, slug: str) -> list[dict[str, Any]]:
    """Отдельное HTTP-соединение; для параллели с stages (httpx.Client не thread-safe)."""
    return KanbanClient(token=token).project_users(slug)


def _kanban_stages_standalone(token: str) -> list[dict[str, Any]]:
    return KanbanClient(token=token).stages()


def _require_kanban_client(user: User) -> KanbanClient:
    if not user.kanban_token:
        raise HTTPException(status_code=409, detail="Kanban не подключён для этого пользователя.")
    return KanbanClient(token=user.kanban_token)


@router.get("/projects", response_model=list[KanbanProjectRead])
def kanban_projects(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[KanbanProjectRead]:
    _ = db
    client = _require_kanban_client(user)
    projects = client.projects()

    reads: list[KanbanProjectRead] = []
    for item in projects:
        if not isinstance(item, dict):
            continue
        slug = item.get("slug")
        name = item.get("name")
        if not slug or not name:
            continue
        reads.append(
            KanbanProjectRead(
                id=int(item.get("id") or 0) or None,
                slug=str(slug),
                name=str(name),
            )
        )
    return reads


@router.get("/projects/{slug}/epics")
def kanban_project_epics(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    """Справочник эпиков проекта (имя + id) для фильтров и форм; DS GET /project/{slug}/list, type_id=5."""
    _ = db
    client = _require_kanban_client(user)
    rows = client.project_epics_catalog(slug)
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            tid = int(row.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if tid <= 0 or tid in seen:
            continue
        name = str(row.get("name") or row.get("title") or "").strip()
        if not name:
            continue
        seen.add(tid)
        out.append({"id": tid, "name": name})
    out.sort(key=lambda x: str(x.get("name") or "").lower())
    return out


@router.get("/projects/{slug}/member-roles")
def kanban_project_member_roles_get(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict[str, Any]:
    """Роли участников проекта: значения из глобальной карты Kanban user id → роль (общие для всех проектов)."""
    client = _require_kanban_client(user)
    token = user.kanban_token or ""
    project_users = _kanban_project_users_standalone(token, slug)
    role_map = load_project_role_map(db, slug)
    members: list[dict[str, Any]] = []
    for u in project_users:
        if not isinstance(u, dict):
            continue
        kid = int(u.get("id") or 0)
        if kid <= 0:
            continue
        name = normalize_person(u) or str(u.get("email") or u.get("username") or kid)
        role = effective_role(role_map, kid)
        members.append({
            "kanban_user_id": kid,
            "display_name": name,
            "role": role.value,
            "role_explicit": has_explicit_role(role_map, kid),
        })
    members.sort(key=lambda r: str(r.get("display_name") or "").lower())
    return {"project_slug": slug, "members": members}


@router.put("/projects/{slug}/member-roles")
def kanban_project_member_roles_put(
    slug: str,
    body: MemberRolesPutBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict[str, Any]:
    client = _require_kanban_client(user)
    token = user.kanban_token or ""
    project_users = _kanban_project_users_standalone(token, slug)
    allowed = {int(u.get("id") or 0) for u in project_users if isinstance(u, dict) and int(u.get("id") or 0) > 0}
    mapping: dict[int, KanbanProjectMemberRole] = {}
    for row in body.roles:
        if row.kanban_user_id not in allowed:
            raise HTTPException(
                status_code=422,
                detail=f"Kanban user id {row.kanban_user_id} is not a member of project {slug!r}.",
            )
        mapping[row.kanban_user_id] = row.role
    save_project_role_map(db, slug, mapping)
    _ = client  # token validated by client
    return kanban_project_member_roles_get(slug, db, user)


@router.get("/projects/{slug}/bundle")
def kanban_project_bundle(
    slug: str,
    only_mine: bool = Query(False, description="Как в DS Kanban: filter[user_id][id] + filter[with_subtasks]=1"),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict[str, Any]:
    _ = db
    cached = _bundle_cache_get(user.id, slug, only_mine)
    if cached is not None:
        return cached

    client = _require_kanban_client(user)
    token = user.kanban_token or ""
    project = client.project_detail(slug)
    flow = project.get("flow") if isinstance(project, dict) else None
    possible_stages = flow.get("possibleProjectStages") if isinstance(flow, dict) else None
    need_global_stages = not (isinstance(possible_stages, list) and len(possible_stages) > 0)
    if need_global_stages:
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_users = pool.submit(_kanban_project_users_standalone, token, slug)
            fut_stages = pool.submit(_kanban_stages_standalone, token)
            users = fut_users.result()
            stages = fut_stages.result()
    else:
        stages = list(possible_stages) if isinstance(possible_stages, list) else []
        users = _kanban_project_users_standalone(token, slug)

    if isinstance(project, dict):
        project = {**project, "users": users}

    task_params: list[tuple[str, str]] = []
    if only_mine:
        me = client.current_user()
        if not isinstance(me, dict):
            raise HTTPException(status_code=502, detail="Kanban: некорректный ответ /auth/user.")
        kid = int(me.get("id") or 0)
        if kid <= 0:
            raise HTTPException(
                status_code=409,
                detail="Не удалось определить id пользователя в Kanban для фильтра «только мои».",
            )
        sid = str(kid)
        task_params = [(f"filter[user_id][{sid}]", sid), ("filter[with_subtasks]", "1")]

    with client.pooled_http():
        tasks = client.project_board_task_list_all(slug, task_params)

    out: dict[str, Any] = {"stages": stages, "project": project, "tasks": tasks}
    _bundle_cache_set(user.id, slug, only_mine, out)
    return out


@router.get("/reference/task-types")
def kanban_reference_task_types(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = db
    return _require_kanban_client(user).task_types()


@router.get("/reference/priorities")
def kanban_reference_priorities(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = db
    return _require_kanban_client(user).priorities()


@router.get("/reference/components")
def kanban_reference_components(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = db
    return _require_kanban_client(user).components()


@router.get("/tasks/{task_id}")
def kanban_task_detail(
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict[str, Any]:
    _ = db
    return _require_kanban_client(user).task(task_id)


@router.patch("/tasks/{task_id}")
def kanban_task_patch(
    task_id: int,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    out = _require_kanban_client(user).patch_task(task_id, body)
    _bundle_cache_invalidate_for_user(user.id)
    return out


@router.post("/projects/{slug}/tasks")
def kanban_project_create_task(
    slug: str,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    out = _require_kanban_client(user).post_project_task(slug, body)
    _bundle_cache_invalidate_project(user.id, slug)
    return out


@router.get("/tasks/{task_id}/comments")
def kanban_task_comments(
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = db
    return _require_kanban_client(user).task_comments(task_id)


@router.post("/tasks/{task_id}/comments")
def kanban_task_post_comment(
    task_id: int,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    return _require_kanban_client(user).post_task_comment(task_id, body)


@router.get("/tasks/{task_id}/work")
def kanban_task_work(
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = db
    return _require_kanban_client(user).task_worklogs(task_id)


@router.post("/tasks/{task_id}/work")
def kanban_task_post_work(
    task_id: int,
    body: dict[str, Any] | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    return _require_kanban_client(user).post_task_work(task_id, body if body is not None else {})


@router.post("/tasks/{task_id}/estimates")
def kanban_task_post_estimate(
    task_id: int,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    return _require_kanban_client(user).post_task_estimate(task_id, body)


@router.post("/tasks/{task_id}/checklist")
def kanban_task_post_checklist(
    task_id: int,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    return _require_kanban_client(user).post_task_checklist(task_id, body)


@router.patch("/checklist-points/{point_id}")
def kanban_checklist_point_patch(
    point_id: int,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> Any:
    _ = db
    return _require_kanban_client(user).patch_checklist_point(point_id, body)
