"""Хранение ролей участников Kanban в Resonance (AppSetting JSON).

Роли задаются по kanban_user_id и общие для всех проектов (одна запись на пользователя).
Старый формат { "project-slug": { "id": "QA" } } читается как миграция до первой записи в
`_by_kanban_user`.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .models import AppSetting

MEMBER_ROLES_SETTING_KEY = "kanban_project_member_roles"
GLOBAL_MEMBER_ROLES_KEY = "_by_kanban_user"

ROLE_ORDER: tuple[str, ...] = ("QA", "Manager", "Frontend", "Backend", "Java", "Other")


class KanbanProjectMemberRole(str, Enum):
    QA = "QA"
    MANAGER = "Manager"
    FRONTEND = "Frontend"
    BACKEND = "Backend"
    JAVA = "Java"
    OTHER = "Other"


def _load_raw(db: Session) -> dict[str, Any]:
    setting = db.get(AppSetting, MEMBER_ROLES_SETTING_KEY)
    if not setting or not isinstance(setting.value_json, dict):
        return {}
    return setting.value_json


def _parse_role_dict(raw: dict[str, Any]) -> dict[int, KanbanProjectMemberRole]:
    out: dict[int, KanbanProjectMemberRole] = {}
    for key, value in raw.items():
        try:
            uid = int(key)
        except (TypeError, ValueError):
            continue
        if uid <= 0:
            continue
        try:
            out[uid] = KanbanProjectMemberRole(str(value))
        except ValueError:
            out[uid] = KanbanProjectMemberRole.OTHER
    return out


def load_global_role_map(db: Session) -> dict[int, KanbanProjectMemberRole]:
    """kanban_user_id → роль (явные записи; без ключа — effective Other)."""
    raw = _load_raw(db)
    bucket = raw.get(GLOBAL_MEMBER_ROLES_KEY)
    if isinstance(bucket, dict):
        return _parse_role_dict(bucket)
    merged: dict[int, KanbanProjectMemberRole] = {}
    for key, val in raw.items():
        if key == GLOBAL_MEMBER_ROLES_KEY or not isinstance(val, dict):
            continue
        merged.update(_parse_role_dict(val))
    return merged


def load_project_role_map(db: Session, project_slug: str) -> dict[int, KanbanProjectMemberRole]:
    """Совместимость: роли не зависят от проекта; project_slug игнорируется."""
    _ = project_slug
    return load_global_role_map(db)


def effective_role(role_map: dict[int, KanbanProjectMemberRole], kanban_user_id: int | None) -> KanbanProjectMemberRole:
    if kanban_user_id is None or kanban_user_id <= 0:
        return KanbanProjectMemberRole.OTHER
    return role_map.get(kanban_user_id, KanbanProjectMemberRole.OTHER)


def has_explicit_role(role_map: dict[int, KanbanProjectMemberRole], kanban_user_id: int) -> bool:
    return kanban_user_id in role_map


def save_project_role_map(db: Session, project_slug: str, mapping: dict[int, KanbanProjectMemberRole]) -> None:
    """Обновляет глобальную карту ролей для пользователей из тела запроса (контекст проекта — только валидация)."""
    _ = project_slug
    current = dict(load_global_role_map(db))
    for kid, role in mapping.items():
        if role == KanbanProjectMemberRole.OTHER:
            current.pop(kid, None)
        else:
            current[kid] = role
    new_root: dict[str, Any] = {
        GLOBAL_MEMBER_ROLES_KEY: {str(k): v.value for k, v in sorted(current.items(), key=lambda x: x[0])}
    }
    setting = db.get(AppSetting, MEMBER_ROLES_SETTING_KEY)
    if not setting:
        setting = AppSetting(key=MEMBER_ROLES_SETTING_KEY, value_json={})
        db.add(setting)
    setting.value_json = new_root
    db.commit()
    db.refresh(setting)


class MemberRoleRow(BaseModel):
    kanban_user_id: int = Field(..., ge=1)
    role: KanbanProjectMemberRole


class MemberRolesPutBody(BaseModel):
    roles: list[MemberRoleRow] = Field(default_factory=list)

    @field_validator("roles")
    @classmethod
    def dedupe_users(cls, v: list[MemberRoleRow]) -> list[MemberRoleRow]:
        by_id: dict[int, MemberRoleRow] = {}
        for row in v:
            by_id[row.kanban_user_id] = row
        return list(by_id.values())
