"""Resolve effective notification delivery policy for a project."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from .models import Project, ProjectNotificationPolicy


@dataclass
class EffectiveNotificationPolicy:
    realtime_matrix_room_enabled: bool
    digest_matrix_room_enabled: bool
    room_delivery_mode: str
    matrix_project_room_id: str | None
    prefer_dm_over_room: bool
    escalation_reminder_hours: int
    escalation_lead_hours: int
    matrix_room_encryption_blocked: bool


def get_effective_policy(db: Session, project_id: int) -> EffectiveNotificationPolicy:
    row = db.get(ProjectNotificationPolicy, project_id)
    project = db.get(Project, project_id)
    cfg = (project.config_json or {}) if project else {}

    if row:
        return EffectiveNotificationPolicy(
            realtime_matrix_room_enabled=row.realtime_matrix_room_enabled,
            digest_matrix_room_enabled=row.digest_matrix_room_enabled,
            room_delivery_mode=row.room_delivery_mode,
            matrix_project_room_id=row.matrix_project_room_id,
            prefer_dm_over_room=row.prefer_dm_over_room,
            escalation_reminder_hours=row.escalation_reminder_hours,
            escalation_lead_hours=row.escalation_lead_hours,
            matrix_room_encryption_blocked=row.matrix_room_encryption_blocked,
        )

    return EffectiveNotificationPolicy(
        realtime_matrix_room_enabled=True,
        digest_matrix_room_enabled=True,
        room_delivery_mode="realtime_and_digest",
        matrix_project_room_id=cfg.get("matrix_project_room_id"),
        prefer_dm_over_room=False,
        escalation_reminder_hours=24,
        escalation_lead_hours=48,
        matrix_room_encryption_blocked=False,
    )
