from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..access_policy import AccessPolicy
from ..config import get_settings
from ..database import get_db
from ..datetime_util import utc_iso_z
from ..deps import require_admin
from ..kanban_client import KanbanClient, normalize_person, normalize_stage, normalize_task, parse_kanban_reference
from ..kanban_member_roles import ROLE_ORDER, effective_role, load_project_role_map
from ..models import AppSetting, Epic, KanbanEpicComment, User, UserRole


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])
settings = get_settings()
SNAPSHOT_KEY = "kanban_analytics_snapshot"
SNAPSHOT_REFRESH_STATE_KEY = "kanban_analytics_snapshot_refresh_state"
SNAPSHOT_REFRESH_RUNNING_TTL = timedelta(minutes=30)
"""Оценка QA для Kanban-эпиков без карточки Resonance: ключ `project_slug:kanban_epic_id` → часы (float)."""
KANBAN_SHADOW_QA_ESTIMATES_KEY = "kanban_epic_qa_estimates_shadow"


def _kanban_client_for_user(user: User) -> KanbanClient:
    token = user.kanban_token or settings.kanban_api_token
    return KanbanClient(token=token)


def _snapshot_item_key(project_slug: str, epic_id: int) -> str:
    return f"{project_slug}:{epic_id}"


def _load_snapshot(db: Session) -> dict[str, Any] | None:
    setting = db.get(AppSetting, SNAPSHOT_KEY)
    if not setting or not isinstance(setting.value_json, dict):
        return None
    return setting.value_json


def _save_snapshot(db: Session, snapshot: dict[str, Any]) -> dict[str, Any]:
    setting = db.get(AppSetting, SNAPSHOT_KEY)
    if not setting:
        setting = AppSetting(key=SNAPSHOT_KEY, value_json={})
        db.add(setting)
    setting.value_json = snapshot
    db.commit()
    db.refresh(setting)
    return setting.value_json


def _default_refresh_state() -> dict[str, Any]:
    return {
        "status": "idle",
        "started_at": None,
        "finished_at": None,
        "started_by": None,
        "error": None,
        "updated_at": utc_iso_z(datetime.utcnow()),
    }


def _refresh_state_is_fresh_running(state: dict[str, Any]) -> bool:
    if state.get("status") != "running":
        return False
    raw = state.get("started_at")
    if not raw:
        return False
    try:
        started = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if started.tzinfo is not None:
        started = started.replace(tzinfo=None)
    return datetime.utcnow() - started < SNAPSHOT_REFRESH_RUNNING_TTL


def _save_snapshot_refresh_state(db: Session, state: dict[str, Any]) -> dict[str, Any]:
    setting = db.get(AppSetting, SNAPSHOT_REFRESH_STATE_KEY)
    if not setting:
        setting = AppSetting(key=SNAPSHOT_REFRESH_STATE_KEY, value_json={})
        db.add(setting)
    setting.value_json = {**_default_refresh_state(), **state, "updated_at": utc_iso_z(datetime.utcnow())}
    db.commit()
    db.refresh(setting)
    return setting.value_json


def _load_snapshot_refresh_state(db: Session) -> dict[str, Any]:
    setting = db.get(AppSetting, SNAPSHOT_REFRESH_STATE_KEY)
    if not setting or not isinstance(setting.value_json, dict):
        return _default_refresh_state()
    state = {**_default_refresh_state(), **setting.value_json}
    if state.get("status") == "running" and not _refresh_state_is_fresh_running(state):
        state = _save_snapshot_refresh_state(
            db,
            {
                **state,
                "status": "failed",
                "finished_at": utc_iso_z(datetime.utcnow()),
                "error": "Обновление снимка Kanban не завершилось за 30 минут. Запустите обновление снова.",
            },
        )
    return state


def _refresh_started_by(user: User | None, source: str) -> dict[str, Any]:
    if user is None:
        return {"source": source}
    return {"source": source, "id": user.id, "username": user.username}


def _mark_snapshot_refresh_running(db: Session, user: User | None, source: str) -> dict[str, Any]:
    current = _load_snapshot_refresh_state(db)
    if _refresh_state_is_fresh_running(current):
        raise HTTPException(status_code=409, detail="Снимок Kanban уже обновляется. Дождитесь завершения текущего обновления.")
    return _save_snapshot_refresh_state(
        db,
        {
            "status": "running",
            "started_at": utc_iso_z(datetime.utcnow()),
            "finished_at": None,
            "started_by": _refresh_started_by(user, source),
            "error": None,
        },
    )


def _mark_snapshot_refresh_success(db: Session) -> dict[str, Any]:
    current = _load_snapshot_refresh_state(db)
    return _save_snapshot_refresh_state(
        db,
        {
            **current,
            "status": "success",
            "finished_at": utc_iso_z(datetime.utcnow()),
            "error": None,
        },
    )


def _mark_snapshot_refresh_failed(db: Session, exc: BaseException) -> dict[str, Any]:
    current = _load_snapshot_refresh_state(db)
    return _save_snapshot_refresh_state(
        db,
        {
            **current,
            "status": "failed",
            "finished_at": utc_iso_z(datetime.utcnow()),
            "error": str(exc)[:500],
        },
    )


def refresh_kanban_analytics_snapshot_from_scheduler(db: Session) -> dict[str, Any] | None:
    """Фоновое обновление снимка Kanban (APScheduler в процессе bot). Токен: kanban_token админа или KANBAN_API_TOKEN."""
    admin = db.scalar(select(User).where(User.role == UserRole.ADMIN).order_by(User.id.asc()).limit(1))
    if not admin:
        logger.warning("Kanban analytics snapshot: пропуск — в БД нет пользователя с ролью admin")
        return None
    token = (admin.kanban_token or settings.kanban_api_token or "").strip()
    if not token:
        logger.warning(
            "Kanban analytics snapshot: пропуск — не задан Kanban-токен (у админа и в KANBAN_API_TOKEN пусто)"
        )
        return None
    try:
        _mark_snapshot_refresh_running(db, admin, "scheduler")
    except HTTPException:
        logger.info("Kanban analytics snapshot: skip scheduler refresh because another refresh is running")
        return None
    try:
        snapshot = _build_snapshot(db, admin)
        stored = _save_snapshot(db, snapshot)
        _mark_snapshot_refresh_success(db)
        return stored
    except Exception as exc:
        _mark_snapshot_refresh_failed(db, exc)
        raise


def refresh_kanban_analytics_snapshot_for_user(db: Session, user: User) -> dict[str, Any]:
    """Ручное обновление снимка от имени авторизованного пользователя (как раньше POST /kanban/refresh)."""
    _mark_snapshot_refresh_running(db, user, "manual")
    try:
        snapshot = _build_snapshot(db, user)
        stored = _save_snapshot(db, snapshot)
        _mark_snapshot_refresh_success(db)
        return stored
    except Exception as exc:
        _mark_snapshot_refresh_failed(db, exc)
        raise


def _build_local_meta(base_meta: dict[str, Any], qa_fact_hours: float | None = None, tracked_hours: float | None = None) -> dict[str, Any]:
    merged = dict(base_meta or {})
    if qa_fact_hours is not None:
        merged["qa_fact_hours"] = qa_fact_hours
    if tracked_hours is not None:
        merged["tracked_hours"] = tracked_hours
    return merged


def _load_shadow_qa_map(db: Session) -> dict[str, Any]:
    setting = db.get(AppSetting, KANBAN_SHADOW_QA_ESTIMATES_KEY)
    if not setting or not isinstance(setting.value_json, dict):
        return {}
    return dict(setting.value_json)


def _save_shadow_qa_map(db: Session, data: dict[str, Any]) -> None:
    setting = db.get(AppSetting, KANBAN_SHADOW_QA_ESTIMATES_KEY)
    if not setting:
        setting = AppSetting(key=KANBAN_SHADOW_QA_ESTIMATES_KEY, value_json={})
        db.add(setting)
    setting.value_json = data
    db.commit()
    db.refresh(setting)


def _shadow_qa_pop(db: Session, project_slug: str, kanban_epic_id: int) -> None:
    key = _snapshot_item_key(project_slug, kanban_epic_id)
    smap = dict(_load_shadow_qa_map(db))
    if key not in smap:
        return
    smap.pop(key, None)
    _save_shadow_qa_map(db, smap)


def _merge_shadow_qa_into_base(db: Session, project_slug: str, kanban_epic_id: int, base: dict[str, Any]) -> dict[str, Any]:
    """Если эпик привязан к Resonance — только данные из БД. Иначе подставляем оценку из shadow-хранилища."""
    out = dict(base or {})
    if out.get("resonance_epic_id"):
        return out
    key = _snapshot_item_key(project_slug, kanban_epic_id)
    raw = _load_shadow_qa_map(db).get(key)
    if raw is None:
        return out
    try:
        out["qa_estimate_hours"] = float(raw)
    except (TypeError, ValueError):
        return out
    return out


def _local_meta_for_kanban_epic(
    db: Session,
    user: User,
    project_slug: str,
    kanban_epic_id: int,
    base_lookup_row: dict[str, Any],
    qa_fact_hours: float | None,
    tracked_hours: float | None,
) -> dict[str, Any]:
    _ = user
    base = _merge_shadow_qa_into_base(db, project_slug, kanban_epic_id, base_lookup_row)
    return _build_local_meta(base, qa_fact_hours=qa_fact_hours, tracked_hours=tracked_hours)


def _find_epic_by_kanban_ref(db: Session, user: User, slug: str, kanban_epic_id: int) -> Epic | None:
    stmt = select(Epic)
    if user.role.value != "admin":
        allowed_ids = AccessPolicy.get_allowed_project_ids(user)
        if not allowed_ids:
            return None
        stmt = stmt.where(Epic.project_id.in_(allowed_ids))
    for epic in db.scalars(stmt).all():
        if not epic.kanban_url:
            continue
        try:
            s, tid = parse_kanban_reference(epic.kanban_url)
        except ValueError:
            continue
        if s == slug and tid == kanban_epic_id:
            return epic
    return None


def _raw_task_type_meta(task: dict[str, Any]) -> tuple[int | None, str]:
    """Соответствует фронтовому resolveTaskTypeId / имя из task_type без отдельного запроса /task_type."""
    tt = task.get("task_type")
    if isinstance(tt, dict):
        try:
            tid = int(tt.get("id") or 0) or None
        except (TypeError, ValueError):
            tid = None
        if tid and tid > 0:
            name = str(tt.get("name") or "").strip()
            if name:
                return tid, name
            return tid, f"Тип #{tid}"
    for key in ("type_id", "task_type_id"):
        raw = task.get(key)
        try:
            tid = int(raw)
        except (TypeError, ValueError):
            continue
        if tid > 0:
            return tid, f"Тип #{tid}"
    return None, "—"


def _raw_task_epic_id(task: dict[str, Any]) -> int | None:
    for key in ("epic", "super_task", "supertask", "parent"):
        raw = task.get(key)
        if isinstance(raw, dict):
            try:
                value = int(raw.get("id") or 0)
            except (TypeError, ValueError):
                value = 0
            if value > 0:
                return value
        elif isinstance(raw, (int, str)) and str(raw).strip().isdigit():
            value = int(str(raw).strip())
            if value > 0:
                return value
    for key in ("epic_id", "epicId", "parent_id", "parentId"):
        try:
            value = int(task.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return None


def _worklog_kanban_user_id(entry: dict[str, Any]) -> int | None:
    """Как во фронтовом workLogKanbanUserId: `user.id` или `user_id` / `userId` у записи Work."""
    user = entry.get("user")
    if isinstance(user, dict):
        try:
            uid = int(user.get("id") or 0)
        except (TypeError, ValueError):
            uid = 0
        if uid > 0:
            return uid
    for key in ("user_id", "userId"):
        raw = entry.get(key)
        if raw is None:
            continue
        try:
            uid = int(raw)
        except (TypeError, ValueError):
            continue
        if uid > 0:
            return uid
    return None


def _project_user_map(project_users: list[Any]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for item in project_users:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        try:
            uid = int(item["id"])
        except (TypeError, ValueError):
            continue
        if uid > 0:
            out[uid] = item
    return out


def _worklog_rows_for_task(
    client: KanbanClient,
    slug: str,
    task_id: int,
    task: dict[str, Any],
    project_user_map: dict[int, dict[str, Any]],
    role_map: dict[int, Any],
) -> list[dict[str, Any]]:
    task_type_id, task_type_name = _raw_task_type_meta(task if isinstance(task, dict) else {})
    rows: list[dict[str, Any]] = []
    for entry in client.task_worklogs(task_id):
        if not isinstance(entry, dict):
            continue
        minutes = int(entry.get("time") or 0)
        kid = _worklog_kanban_user_id(entry)
        user_name = normalize_person(entry.get("user"))
        if not user_name and kid is not None and kid in project_user_map:
            user_name = normalize_person(project_user_map.get(kid))
        user_name = user_name or "Unknown"
        role = effective_role(role_map, kid)
        rows.append({
            "task_id": task_id,
            "task_name": task.get("name") or task.get("title") or f"#{task_id}",
            "task_url": client.task_url(slug, task_id),
            "task_type_id": task_type_id,
            "task_type_name": task_type_name,
            "member_role": role.value,
            "user_name": user_name,
            "kanban_user_id": kid if kid and kid > 0 else None,
            "minutes": minutes,
            "hours": round(minutes / 60, 2),
            "comment": (entry.get("comment") or "").strip(),
            "begin": entry.get("begin"),
        })
    return rows


def _epic_detail_aggregate(
    client: KanbanClient,
    db: Session,
    slug: str,
    project: dict[str, Any],
    epic_id: int,
    epic_payload: dict[str, Any],
    tasks_payload: list[Any],
    stages_map: dict[int, Any],
    project_users: list[Any],
    normalized_map: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Сводка эпика + worklog + workload; часы по ролям из Resonance (глобальная карта kanban_project_member_roles)."""
    role_map = load_project_role_map(db, slug)
    hours_by_role: dict[str, float] = {role: 0.0 for role in ROLE_ORDER}

    normalized_tasks = [
        normalize_task(task, project, stages_map, project_users, client.web_base_url)
        for task in tasks_payload
    ]

    worklog_rows: list[dict[str, Any]] = []
    total_minutes = 0
    hours_by_user: dict[str, int] = defaultdict(int)
    minutes_by_task_id: dict[int, int] = defaultdict(int)

    project_user_map = _project_user_map(project_users)

    task_lookup: dict[int, dict[str, Any]] = {}
    for task in tasks_payload:
        tid = int(task.get("id") or 0)
        if tid:
            task_lookup[tid] = task if isinstance(task, dict) else {}
    if epic_id not in task_lookup:
        task_lookup[epic_id] = epic_payload if isinstance(epic_payload, dict) else {}

    worklog_task_order = [epic_id] + [tid for tid in task_lookup if tid != epic_id]

    for task_id in worklog_task_order:
        task = task_lookup.get(task_id) or {}
        for row in _worklog_rows_for_task(client, slug, task_id, task, project_user_map, role_map):
            minutes = int(row.get("minutes") or 0)
            total_minutes += minutes
            minutes_by_task_id[task_id] += minutes
            user_name = str(row.get("user_name") or "Unknown")
            hours_by_user[user_name] += minutes
            role = str(row.get("member_role") or "Other")
            hours_by_role[role] = hours_by_role.get(role, 0.0) + minutes / 60.0
            worklog_rows.append(row)

    for task in normalized_tasks:
        task_id = int(task.get("id") or 0)
        tracked_hours = round(minutes_by_task_id.get(task_id, 0) / 60, 2)
        task["tracked_hours"] = tracked_hours
        if normalized_map is not None and task_id in normalized_map:
            normalized_map[task_id]["tracked_hours"] = tracked_hours

    worklog_rows.sort(key=lambda row: row.get("begin") or "", reverse=True)
    normalized_tasks.sort(key=lambda item: int(item["id"] or 0), reverse=True)

    return {
        "epic": {
            "id": epic_id,
            "name": epic_payload.get("name") or epic_payload.get("title") or "",
            "project": {"id": project.get("id"), "slug": slug, "name": project.get("name")},
            "stage": normalize_stage(epic_payload, stages_map),
            "deadline": epic_payload.get("deadline") or epic_payload.get("deadline_date") or epic_payload.get("due_date"),
            "created_at": epic_payload.get("created_at") or utc_iso_z(datetime.utcnow()),
            "url": client.task_url(slug, epic_id),
        },
        "summary": {
            "task_count": len(normalized_tasks),
            "in_progress_count": sum(1 for item in normalized_tasks if item["stage"]["id"] in {2, 4, 5, 6}),
            "done_count": sum(1 for item in normalized_tasks if item["stage"]["id"] in {3, 7, 8}),
            "tracked_hours": round(total_minutes / 60, 2),
            "hours_by_role": {role: round(hours_by_role.get(role, 0.0), 2) for role in ROLE_ORDER},
        },
        "tasks": normalized_tasks,
        "worklogs": worklog_rows,
        "workload": [
            {"user_name": user_name, "hours": round(minutes / 60, 2)}
            for user_name, minutes in sorted(hours_by_user.items(), key=lambda item: item[1], reverse=True)
        ],
    }


def _require_snapshot(db: Session) -> dict[str, Any]:
    snapshot = _load_snapshot(db)
    if not snapshot:
        raise HTTPException(status_code=409, detail="Снимок Kanban ещё не создан. Нажмите обновление в аналитике.")
    return snapshot


def _build_snapshot(db: Session, user: User) -> dict[str, Any]:
    client = _kanban_client_for_user(user)
    current_user = client.current_user()
    stages = client.stages()
    projects = client.projects()
    stages_map = {int(item.get("id")): item for item in stages if item.get("id") is not None}
    epic_stage_ids = [stage_id for stage_id in stages_map.keys() if stage_id > 0] or list(range(1, 9))
    task_stage_ids = [stage_id for stage_id in stages_map.keys() if stage_id > 0 and stage_id != 8] or list(range(1, 8))

    epic_items: list[dict[str, Any]] = []
    task_items: list[dict[str, Any]] = []
    epic_details: dict[str, Any] = {}
    task_standalone_details: dict[str, Any] = {}

    for project in projects:
        slug = project.get("slug")
        if not slug:
            continue

        project_users = client.project_users(slug)
        project_user_map = {int(item.get("id")): item for item in project_users if isinstance(item, dict) and item.get("id") is not None}
        epic_params = [("filter[type_id][5]", "5"), *[(f"filter[stage_id][{stage_id}]", str(stage_id)) for stage_id in epic_stage_ids]]
        task_params = [(f"filter[stage_id][{stage_id}]", str(stage_id)) for stage_id in task_stage_ids]
        raw_epics = client.project_list_all(slug, params=epic_params)
        raw_tasks = client.project_list_all(slug, params=task_params)
        normalized_map: dict[int, dict[str, Any]] = {}
        task_raw_map: dict[int, dict[str, Any]] = {}

        for item in raw_epics:
            normalized = normalize_task(item, project, stages_map, project_users, client.web_base_url)
            member_ids: set[int] = set()
            for key in ("assignees", "users", "executors"):
                for member in item.get(key) or []:
                    if isinstance(member, dict):
                        member_id = member.get("id") or member.get("user_id")
                    else:
                        member_id = member
                    try:
                        member_id = int(member_id)
                    except (TypeError, ValueError):
                        continue
                    if member_id > 0:
                        member_ids.add(member_id)

            responsible = item.get("responsible")
            responsible_id = None
            if isinstance(responsible, dict):
                try:
                    responsible_id = int(responsible.get("id") or 0) or None
                except (TypeError, ValueError):
                    responsible_id = None
            if not responsible_id:
                try:
                    responsible_id = int(item.get("responsible_id") or 0) or None
                except (TypeError, ValueError):
                    responsible_id = None
            if responsible_id:
                member_ids.add(responsible_id)

            created_by = None
            try:
                created_by = int(item.get("created_by") or 0) or None
            except (TypeError, ValueError):
                created_by = None

            normalized["member_ids"] = sorted(member_ids)
            normalized["responsible_id"] = responsible_id
            normalized["created_by"] = created_by
            normalized["user_id"] = created_by
            if responsible_id and not normalized.get("assignees"):
                mapped_name = normalize_person(project_user_map.get(responsible_id))
                if mapped_name:
                    normalized["assignees"] = [mapped_name]
            normalized_map[int(normalized.get("id") or 0)] = normalized
            epic_items.append(normalized)

        for item in raw_tasks:
            if int(item.get("type_id") or 0) == 5:
                continue
            task_id = int(item.get("id") or 0)
            if task_id > 0:
                task_raw_map[task_id] = item
            normalized = normalize_task(item, project, stages_map, project_users, client.web_base_url)
            member_ids: set[int] = set()
            for key in ("assignees", "users", "executors"):
                for member in item.get(key) or []:
                    if isinstance(member, dict):
                        member_id = member.get("id") or member.get("user_id")
                    else:
                        member_id = member
                    try:
                        member_id = int(member_id)
                    except (TypeError, ValueError):
                        continue
                    if member_id > 0:
                        member_ids.add(member_id)
            responsible = item.get("responsible")
            responsible_id = None
            if isinstance(responsible, dict):
                try:
                    responsible_id = int(responsible.get("id") or 0) or None
                except (TypeError, ValueError):
                    responsible_id = None
            if not responsible_id:
                try:
                    responsible_id = int(item.get("responsible_id") or 0) or None
                except (TypeError, ValueError):
                    responsible_id = None
            if responsible_id:
                member_ids.add(responsible_id)
            created_by = None
            try:
                created_by = int(item.get("created_by") or 0) or None
            except (TypeError, ValueError):
                created_by = None
            normalized["member_ids"] = sorted(member_ids)
            normalized["responsible_id"] = responsible_id
            normalized["created_by"] = created_by
            normalized["user_id"] = created_by
            if responsible_id and not normalized.get("assignees"):
                mapped_name = normalize_person(project_user_map.get(responsible_id))
                if mapped_name:
                    normalized["assignees"] = [mapped_name]
            normalized_map[int(normalized.get("id") or 0)] = normalized
            task_items.append(normalized)

        epic_task_ids: set[int] = set()
        for epic in raw_epics:
            epic_id = int(epic.get("id") or 0)
            if not epic_id:
                continue
            epic_task_ids.add(epic_id)

            epic_payload = client.task(epic_id)
            embedded_tasks = epic_payload.get("epic_by")
            tasks_payload = embedded_tasks if isinstance(embedded_tasks, list) else client.project_list_all(slug, params=[(f"filter[epic_id][{epic_id}]", str(epic_id))])
            for task in tasks_payload:
                if not isinstance(task, dict):
                    continue
                try:
                    linked_task_id = int(task.get("id") or 0)
                except (TypeError, ValueError):
                    linked_task_id = 0
                if linked_task_id > 0:
                    epic_task_ids.add(linked_task_id)

            detail = _epic_detail_aggregate(
                client,
                db,
                slug,
                project,
                epic_id,
                epic_payload,
                tasks_payload,
                stages_map,
                project_users,
                normalized_map,
            )
            epic_details[_snapshot_item_key(slug, epic_id)] = detail

        role_map = load_project_role_map(db, slug)
        project_user_lookup = _project_user_map(project_users)
        for task_id, raw_task in task_raw_map.items():
            if task_id in epic_task_ids or _raw_task_epic_id(raw_task) is not None:
                continue
            normalized = normalized_map.get(task_id) or normalize_task(raw_task, project, stages_map, project_users, client.web_base_url)
            rows = _worklog_rows_for_task(client, slug, task_id, raw_task, project_user_lookup, role_map)
            rows.sort(key=lambda row: row.get("begin") or "", reverse=True)
            tracked_hours = round(sum(int(row.get("minutes") or 0) for row in rows) / 60, 2)
            normalized["tracked_hours"] = tracked_hours
            if task_id in normalized_map:
                normalized_map[task_id]["tracked_hours"] = tracked_hours
            task_standalone_details[_snapshot_item_key(slug, task_id)] = {
                "task": normalized,
                "worklogs": rows,
            }

    return {
        "updated_at": utc_iso_z(datetime.utcnow()),
        "refreshed_by": {"id": user.id, "username": user.username},
        "current_user": {
            "id": current_user.get("id"),
            "name": normalize_person(current_user) or current_user.get("email") or current_user.get("username"),
        },
        "projects": [{"id": item.get("id"), "slug": item.get("slug"), "name": item.get("name")} for item in projects],
        "stages": [{"id": item.get("id"), "name": item.get("name")} for item in stages],
        "epics": epic_items,
        "tasks": task_items,
        "epic_details": epic_details,
        "task_standalone_details": task_standalone_details,
    }


def _load_local_epic_lookup(db: Session, user: User) -> dict[str, dict[str, Any]]:
    stmt = select(Epic).options(selectinload(Epic.project), selectinload(Epic.qa_block))
    if user.role.value != "admin":
        allowed_ids = AccessPolicy.get_allowed_project_ids(user)
        if allowed_ids:
            stmt = stmt.where(Epic.project_id.in_(allowed_ids))
        else:
            return {}

    lookup: dict[str, dict[str, Any]] = {}
    for epic in db.scalars(stmt).all():
        if not epic.kanban_url:
            continue
        try:
            slug, kanban_task_id = parse_kanban_reference(epic.kanban_url)
        except ValueError:
            continue
        lookup[_snapshot_item_key(slug, kanban_task_id)] = {
            "resonance_epic_id": epic.id,
            "resonance_epic_title": epic.title,
            "resonance_project_id": epic.project_id,
            "qa_estimate_hours": epic.qa_estimate_hours,
            "spent_total_hours": epic.spent_total_hours,
            "spent_qa_hours": epic.spent_qa_hours,
            "qa_member_ids": epic.qa_member_ids or [],
            "qa_status": epic.qa_block.status if epic.qa_block else None,
            "active_test_stage": epic.qa_block.active_test_stage if epic.qa_block else None,
        }
    return lookup


def _kanban_comments_read(db: Session, project_slug: str, kanban_epic_id: int) -> list[dict[str, Any]]:
    comments = db.scalars(
        select(KanbanEpicComment)
        .where(
            KanbanEpicComment.project_slug == project_slug,
            KanbanEpicComment.kanban_epic_id == kanban_epic_id,
        )
        .order_by(KanbanEpicComment.created_at.desc(), KanbanEpicComment.id.desc())
    ).all()
    items: list[dict[str, Any]] = []
    for comment in comments:
        actor = db.get(User, comment.user_id) if comment.user_id else None
        items.append({
            "id": comment.id,
            "epic_id": None,
            "project_slug": project_slug,
            "kanban_epic_id": kanban_epic_id,
            "user_id": comment.user_id,
            "username": actor.username if actor else "System",
            "body": comment.body,
            "created_at": comment.created_at,
        })
    return items


def _selected_stage_ids(raw: str | None, all_stage_ids: list[int]) -> list[int]:
    if not raw or raw == "all":
        return [stage_id for stage_id in all_stage_ids if stage_id != 8] or all_stage_ids
    result: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            result.append(int(part))
        except ValueError:
            continue
    return result or all_stage_ids


def _matches_stage_filter(item: dict[str, Any], active_stage_ids: list[int]) -> bool:
    if not active_stage_ids:
        return True
    try:
        stage_id = int((item.get("stage") or {}).get("id") or 0)
    except (TypeError, ValueError):
        stage_id = 0
    if stage_id <= 0:
        return True
    return stage_id in active_stage_ids


def _selected_project_slugs(raw: str | None) -> list[str]:
    if not raw or raw == "all":
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _task_belongs_to_user(task: dict[str, Any], current_user_id: int) -> bool:
    if task.get("user_id") == current_user_id or task.get("responsible_id") == current_user_id or task.get("created_by") == current_user_id:
        return True

    member_ids = task.get("member_ids") or []
    for member_id in member_ids:
        if member_id == current_user_id:
            return True

    for key in ("assignees", "users", "executors"):
        items = task.get(key) or []
        for item in items:
            if isinstance(item, dict):
                if item.get("id") == current_user_id or item.get("user_id") == current_user_id:
                    return True
            elif item == current_user_id:
                return True

    responsible = task.get("responsible")
    if isinstance(responsible, dict) and responsible.get("id") == current_user_id:
        return True
    return False


def _worklog_day_local(begin: Any) -> str | None:
    if begin is None:
        return None
    text = str(begin).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text[:10] if len(text) >= 10 else None
    if dt.tzinfo is not None:
        dt = dt.astimezone()
    return dt.strftime("%Y-%m-%d")


def _worklog_matches_day_user(row: dict[str, Any], day: str, kanban_user_id: int) -> bool:
    if _worklog_day_local(row.get("begin")) != day:
        return False
    try:
        row_user_id = int(row.get("kanban_user_id") or 0)
    except (TypeError, ValueError):
        row_user_id = 0
    return row_user_id == kanban_user_id


def _task_summary_from_worklog(row: dict[str, Any], project: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("task_id"),
        "name": row.get("task_name") or f"#{row.get('task_id')}",
        "project": project,
        "url": row.get("task_url"),
    }


def _summary_task_node(task: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    minutes = sum(int(row.get("minutes") or 0) for row in rows)
    rows.sort(key=lambda row: row.get("begin") or "", reverse=True)
    return {
        "task": task,
        "worklogs": rows,
        "total_minutes": minutes,
        "total_hours": round(minutes / 60, 2),
    }


def _collect_kanban_worklog_users(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    users: dict[int, str] = {}
    for detail in (snapshot.get("epic_details") or {}).values():
        if not isinstance(detail, dict):
            continue
        for row in detail.get("worklogs") or []:
            if not isinstance(row, dict):
                continue
            try:
                kid = int(row.get("kanban_user_id") or 0)
            except (TypeError, ValueError):
                kid = 0
            if kid > 0:
                users[kid] = str(row.get("user_name") or f"#{kid}")
    for detail in (snapshot.get("task_standalone_details") or {}).values():
        if not isinstance(detail, dict):
            continue
        for row in detail.get("worklogs") or []:
            if not isinstance(row, dict):
                continue
            try:
                kid = int(row.get("kanban_user_id") or 0)
            except (TypeError, ValueError):
                kid = 0
            if kid > 0:
                users[kid] = str(row.get("user_name") or f"#{kid}")
    current = snapshot.get("current_user") or {}
    try:
        current_id = int(current.get("id") or 0)
    except (TypeError, ValueError):
        current_id = 0
    if current_id > 0:
        users.setdefault(current_id, str(current.get("name") or f"#{current_id}"))
    return [
        {"id": uid, "name": name}
        for uid, name in sorted(users.items(), key=lambda item: item[1].lower())
    ]


def _kanban_daily_summary_from_snapshot(
    snapshot: dict[str, Any],
    day: str,
    kanban_user_id: int | None = None,
) -> dict[str, Any]:
    current = snapshot.get("current_user") or {}
    if kanban_user_id is None:
        try:
            kanban_user_id = int(current.get("id") or 0)
        except (TypeError, ValueError):
            kanban_user_id = 0
    if not kanban_user_id or kanban_user_id <= 0:
        raise HTTPException(status_code=400, detail="Kanban user id is required.")

    users = _collect_kanban_worklog_users(snapshot)
    user_name = next((u["name"] for u in users if u["id"] == kanban_user_id), None)
    try:
        current_id = int(current.get("id") or 0)
    except (TypeError, ValueError):
        current_id = 0
    if not user_name and current_id == kanban_user_id:
        user_name = current.get("name")

    projects_by_slug: dict[str, dict[str, Any]] = {}

    def project_node(project: dict[str, Any]) -> dict[str, Any]:
        slug = str(project.get("slug") or "")
        node = projects_by_slug.get(slug)
        if node is None:
            node = {
                "project": project,
                "epics": [],
                "without_epic": {"name": "Без эпика", "tasks": [], "total_minutes": 0, "total_hours": 0.0},
                "total_minutes": 0,
                "total_hours": 0.0,
            }
            projects_by_slug[slug] = node
        return node

    for detail in (snapshot.get("epic_details") or {}).values():
        if not isinstance(detail, dict):
            continue
        epic = detail.get("epic") or {}
        project = epic.get("project") or {}
        matched = [
            dict(row)
            for row in detail.get("worklogs") or []
            if isinstance(row, dict) and _worklog_matches_day_user(row, day, kanban_user_id)
        ]
        if not matched:
            continue
        tasks_by_id: dict[int, dict[str, Any]] = {}
        for task in detail.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            try:
                tid = int(task.get("id") or 0)
            except (TypeError, ValueError):
                tid = 0
            if tid > 0:
                tasks_by_id[tid] = task
        try:
            epic_id = int(epic.get("id") or 0)
        except (TypeError, ValueError):
            epic_id = 0
        if epic_id > 0:
            tasks_by_id[epic_id] = {
                "id": epic_id,
                "name": epic.get("name") or f"#{epic_id}",
                "project": project,
                "stage": epic.get("stage"),
                "deadline": epic.get("deadline"),
                "url": epic.get("url"),
            }

        rows_by_task: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in matched:
            try:
                tid = int(row.get("task_id") or 0)
            except (TypeError, ValueError):
                tid = 0
            rows_by_task[tid].append(row)
        task_nodes = [
            _summary_task_node(tasks_by_id.get(tid) or _task_summary_from_worklog(rows[0], project), rows)
            for tid, rows in rows_by_task.items()
        ]
        task_nodes.sort(key=lambda item: str((item.get("task") or {}).get("name") or "").lower())
        minutes = sum(int(item.get("total_minutes") or 0) for item in task_nodes)
        node = project_node(project)
        node["epics"].append({
            "epic": epic,
            "tasks": task_nodes,
            "total_minutes": minutes,
            "total_hours": round(minutes / 60, 2),
        })
        node["total_minutes"] += minutes

    for detail in (snapshot.get("task_standalone_details") or {}).values():
        if not isinstance(detail, dict):
            continue
        task = detail.get("task") or {}
        project = task.get("project") or {}
        matched = [
            dict(row)
            for row in detail.get("worklogs") or []
            if isinstance(row, dict) and _worklog_matches_day_user(row, day, kanban_user_id)
        ]
        if not matched:
            continue
        task_node = _summary_task_node(task, matched)
        minutes = int(task_node.get("total_minutes") or 0)
        node = project_node(project)
        node["without_epic"]["tasks"].append(task_node)
        node["without_epic"]["total_minutes"] += minutes
        node["total_minutes"] += minutes

    projects = []
    for node in projects_by_slug.values():
        node["epics"].sort(key=lambda item: str((item.get("epic") or {}).get("name") or "").lower())
        node["without_epic"]["tasks"].sort(key=lambda item: str((item.get("task") or {}).get("name") or "").lower())
        node["without_epic"]["total_hours"] = round(int(node["without_epic"]["total_minutes"] or 0) / 60, 2)
        node["total_hours"] = round(int(node["total_minutes"] or 0) / 60, 2)
        projects.append(node)
    projects.sort(key=lambda item: str((item.get("project") or {}).get("name") or "").lower())

    total_minutes = sum(int(item.get("total_minutes") or 0) for item in projects)
    return {
        "day": day,
        "kanban_user": {"id": kanban_user_id, "name": user_name or f"#{kanban_user_id}"},
        "users": users,
        "projects": projects,
        "summary": {
            "projects": len(projects),
            "epics": sum(len(item.get("epics") or []) for item in projects),
            "tasks": sum(
                sum(len(epic.get("tasks") or []) for epic in item.get("epics") or [])
                + len((item.get("without_epic") or {}).get("tasks") or [])
                for item in projects
            ),
            "worklogs": sum(
                sum(sum(len(task.get("worklogs") or []) for task in epic.get("tasks") or []) for epic in item.get("epics") or [])
                + sum(len(task.get("worklogs") or []) for task in (item.get("without_epic") or {}).get("tasks") or [])
                for item in projects
            ),
            "total_minutes": total_minutes,
            "total_hours": round(total_minutes / 60, 2),
        },
    }


@router.get("/kanban/bootstrap")
def kanban_bootstrap(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snapshot = _load_snapshot(db)
    return {
        "current_user": (snapshot or {}).get("current_user"),
        "projects": (snapshot or {}).get("projects", []),
        "stages": (snapshot or {}).get("stages", []),
        "kanban_web_base_url": settings.kanban_api_base_url.rstrip("/")[:-4] if settings.kanban_api_base_url.rstrip("/").endswith("/api") else settings.kanban_api_base_url.rstrip("/"),
        "snapshot_ready": bool(snapshot),
        "snapshot_updated_at": (snapshot or {}).get("updated_at"),
        "refresh_state": _load_snapshot_refresh_state(db),
    }


@router.post("/kanban/refresh")
def refresh_kanban_snapshot(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stored = refresh_kanban_analytics_snapshot_for_user(db, user)
    return {
        "updated_at": stored.get("updated_at"),
        "projects": len(stored.get("projects") or []),
        "epics": len(stored.get("epics") or []),
        "tasks": len(stored.get("tasks") or []),
    }


@router.get("/kanban/epics")
def kanban_epics(
    project_slugs: str | None = Query(default=None),
    status_ids: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snapshot = _require_snapshot(db)
    stages = snapshot.get("stages") or []
    stages_map = {int(item.get("id")): item for item in stages if item.get("id") is not None}
    active_stage_ids = _selected_stage_ids(status_ids, list(stages_map.keys()))
    selected_slugs = set(_selected_project_slugs(project_slugs))
    local_epic_lookup = _load_local_epic_lookup(db, user)
    lowered_search = (search or "").strip().lower()
    details_map = snapshot.get("epic_details") or {}
    epics: list[dict[str, Any]] = []

    for item in snapshot.get("epics") or []:
        project = item.get("project") or {}
        slug = project.get("slug")
        if not slug or not isinstance(slug, str):
            continue
        if selected_slugs and slug not in selected_slugs:
            continue
        if not _matches_stage_filter(item, active_stage_ids):
            continue
        if lowered_search and lowered_search not in str(item.get("name") or "").lower():
            continue
        detail = details_map.get(_snapshot_item_key(slug, int(item.get("id") or 0))) or {}
        summary = detail.get("summary") or {}
        hbr = summary.get("hours_by_role")
        qa_fact_hours = float(hbr["QA"]) if isinstance(hbr, dict) and hbr.get("QA") is not None else None
        tracked_hours = summary.get("tracked_hours")
        local_meta = _local_meta_for_kanban_epic(
            db,
            user,
            slug,
            int(item.get("id") or 0),
            local_epic_lookup.get(_snapshot_item_key(slug, int(item.get("id") or 0)), {}),
            qa_fact_hours=qa_fact_hours,
            tracked_hours=tracked_hours,
        )
        task_summary = {
            "total": int(summary.get("task_count") or 0),
            "in_progress": int(summary.get("in_progress_count") or 0),
            "completed": int(summary.get("done_count") or 0),
        }
        epics.append({**item, "local_meta": local_meta, "task_summary": task_summary})

    epics.sort(key=lambda item: ((item.get("deadline") or "9999"), item["project"]["name"], item["name"]))

    over_estimate = sum(
        1
        for item in epics
        if item["local_meta"].get("qa_estimate_hours")
        and item["local_meta"].get("qa_fact_hours") is not None
        and float(item["local_meta"]["qa_fact_hours"]) > float(item["local_meta"]["qa_estimate_hours"])
    )
    total = len(epics)
    page_items = epics[(page - 1) * page_size:page * page_size]

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "total": total,
            "projects": len({item["project"]["slug"] for item in epics}),
            "over_estimate": over_estimate,
        },
    }


@router.get("/kanban/tasks")
def kanban_tasks(
    project_slugs: str | None = Query(default=None),
    status_ids: str | None = Query(default=None),
    search: str | None = Query(default=None),
    only_mine: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snapshot = _require_snapshot(db)
    current_user = snapshot.get("current_user") or {}
    try:
        current_user_id = int(current_user.get("id") or 0)
    except (TypeError, ValueError):
        current_user_id = 0
    stages = snapshot.get("stages") or []
    stages_map = {int(item.get("id")): item for item in stages if item.get("id") is not None}
    active_stage_ids = _selected_stage_ids(status_ids, list(stages_map.keys()))
    selected_slugs = set(_selected_project_slugs(project_slugs))
    lowered_search = (search or "").strip().lower()

    items: list[dict[str, Any]] = []
    for task in snapshot.get("tasks") or []:
        project = task.get("project") or {}
        slug = project.get("slug")
        if not slug or (selected_slugs and slug not in selected_slugs):
            continue
        if not _matches_stage_filter(task, active_stage_ids):
            continue
        if only_mine and current_user_id and not _task_belongs_to_user(task, current_user_id):
            continue
        if lowered_search and lowered_search not in str(task.get("name") or "").lower():
            continue
        items.append(task)

    items.sort(key=lambda item: (item.get("deadline") or "9999", -int(item["id"] or 0)))
    total = len(items)
    page_items = items[(page - 1) * page_size:page * page_size]
    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "total": total,
            "projects": len({item["project"]["slug"] for item in items}),
            "mine": only_mine,
        },
    }


@router.get("/kanban/summary/day")
def kanban_summary_day(
    day: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    kanban_user_id: int | None = Query(default=None),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snapshot = _require_snapshot(db)
    return _kanban_daily_summary_from_snapshot(snapshot, day, kanban_user_id)


@router.get("/kanban/epics/{epic_id}/charts")
def kanban_epic_charts_live(
    epic_id: int,
    project_slug: str = Query(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Графики эпика: live-агрегация из Kanban API (без снимка)."""
    if not user.kanban_token and not (settings.kanban_api_token or "").strip():
        raise HTTPException(status_code=409, detail="Kanban не подключён: нужен токен пользователя или KANBAN_API_TOKEN.")

    client = _kanban_client_for_user(user)
    stages = client.stages()
    stages_map = {int(item.get("id")): item for item in stages if item.get("id") is not None}
    projects = client.projects()
    project = next((p for p in projects if p.get("slug") == project_slug), None)
    if not project:
        raise HTTPException(status_code=404, detail=f"Проект {project_slug!r} не найден в Kanban.")

    slug = str(project_slug)
    project_users = client.project_users(slug)
    epic_payload = client.task(epic_id)
    if int(epic_payload.get("id") or 0) != epic_id:
        raise HTTPException(status_code=404, detail="Эпик Kanban не найден.")

    emb_proj = epic_payload.get("project") if isinstance(epic_payload.get("project"), dict) else {}
    epic_slug = emb_proj.get("slug")
    if epic_slug and str(epic_slug) != slug:
        raise HTTPException(status_code=400, detail="Эпик не принадлежит указанному проекту.")

    embedded_tasks = epic_payload.get("epic_by")
    tasks_payload = embedded_tasks if isinstance(embedded_tasks, list) else client.project_list_all(
        slug, params=[(f"filter[epic_id][{epic_id}]", str(epic_id))]
    )

    with client.pooled_http():
        detail = _epic_detail_aggregate(
            client,
            db,
            slug,
            project,
            epic_id,
            epic_payload,
            tasks_payload,
            stages_map,
            project_users,
            None,
        )

    summary = detail.get("summary") or {}
    tracked_hours = summary.get("tracked_hours")
    hbr = summary.get("hours_by_role")
    qa_fact_hours = float(hbr["QA"]) if isinstance(hbr, dict) and hbr.get("QA") is not None else None

    local_lookup = _load_local_epic_lookup(db, user)
    local_meta = _local_meta_for_kanban_epic(
        db,
        user,
        slug,
        epic_id,
        local_lookup.get(_snapshot_item_key(slug, epic_id), {}),
        qa_fact_hours=qa_fact_hours,
        tracked_hours=tracked_hours,
    )

    return {
        **detail,
        "charts_ready": True,
        "epic": {
            **(detail.get("epic") or {}),
            "local_meta": local_meta,
        },
    }


@router.get("/kanban/epics/{epic_id}")
def kanban_epic_detail(
    epic_id: int,
    project_slug: str = Query(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snapshot = _require_snapshot(db)
    detail = (snapshot.get("epic_details") or {}).get(_snapshot_item_key(project_slug, epic_id))
    if not detail:
        raise HTTPException(status_code=404, detail="Kanban epic not found in snapshot.")

    local_lookup = _load_local_epic_lookup(db, user)
    summary = detail.get("summary") or {}
    hbr = summary.get("hours_by_role")
    qa_fact_hours = float(hbr["QA"]) if isinstance(hbr, dict) and hbr.get("QA") is not None else None
    tracked_hours = summary.get("tracked_hours")
    local_meta = _local_meta_for_kanban_epic(
        db,
        user,
        project_slug,
        epic_id,
        local_lookup.get(_snapshot_item_key(project_slug, epic_id), {}),
        qa_fact_hours=qa_fact_hours,
        tracked_hours=tracked_hours,
    )

    return {
        **detail,
        "epic": {
            **(detail.get("epic") or {}),
            "local_meta": local_meta,
        },
    }


@router.put("/kanban/epics/{epic_id}/qa-estimate")
def kanban_epic_put_qa_estimate(
    epic_id: int,
    payload: dict[str, Any],
    project_slug: str = Query(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Оценка QA: запись в эпик Resonance при привязке по kanban_url, иначе — в AppSetting по ключу slug:epic_id."""
    _ = user
    if "qa_estimate_hours" not in payload:
        raise HTTPException(status_code=422, detail="Укажите qa_estimate_hours (число или null).")
    raw = payload.get("qa_estimate_hours")
    if raw is None:
        value: float | None = None
    else:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="qa_estimate_hours должно быть числом.")
        if value < 0:
            raise HTTPException(status_code=422, detail="Оценка не может быть отрицательной.")

    epic = _find_epic_by_kanban_ref(db, user, project_slug, epic_id)
    if epic:
        epic.qa_estimate_hours = value
        db.commit()
        db.refresh(epic)
        _shadow_qa_pop(db, project_slug, epic_id)
        return {
            "ok": True,
            "storage": "epic",
            "resonance_epic_id": epic.id,
            "qa_estimate_hours": epic.qa_estimate_hours,
        }

    key = _snapshot_item_key(project_slug, epic_id)
    smap = dict(_load_shadow_qa_map(db))
    if value is None:
        smap.pop(key, None)
    else:
        smap[key] = value
    _save_shadow_qa_map(db, smap)
    return {"ok": True, "storage": "shadow", "qa_estimate_hours": value}
def kanban_epic_comments(
    epic_id: int,
    project_slug: str = Query(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    _ = user
    return _kanban_comments_read(db, project_slug, epic_id)


@router.post("/kanban/epics/{epic_id}/comments")
def add_kanban_epic_comment(
    epic_id: int,
    payload: dict[str, Any],
    project_slug: str = Query(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    body = str(payload.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Comment body cannot be empty.")

    comment = KanbanEpicComment(
        project_slug=project_slug,
        kanban_epic_id=epic_id,
        user_id=user.id,
        body=body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "epic_id": None,
        "project_slug": project_slug,
        "kanban_epic_id": epic_id,
        "user_id": user.id,
        "username": user.username,
        "body": comment.body,
        "created_at": comment.created_at,
    }
