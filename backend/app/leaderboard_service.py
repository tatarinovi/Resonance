"""Persisted leaderboard read models and transactional scoring operations.

Call mutations under serialized() and commit before releasing it. PostgreSQL's
transaction advisory lock serializes the API and scheduler across processes.
"""
from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime
from threading import RLock
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .datetime_util import utc_iso_z
from .leaderboard_rules import eligible, execution_points, season_key, season_rules
from .models import (LeaderboardAudit, LeaderboardBug, LeaderboardContribution,
                     LeaderboardSeason, User)

_LOCK = RLock()


@contextmanager
def serialized(db: Session):
    with _LOCK:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(824610021)"))
        try:
            yield
            db.commit()
        except Exception:
            db.rollback()
            raise


def roster(db: Session) -> list[dict]:
    return [{"id": user.id, "name": user.username} for user in db.scalars(select(User).order_by(User.id)) if eligible(user)]


def ensure_current(db: Session, now: datetime | None = None) -> LeaderboardSeason:
    now = now or datetime.utcnow()
    key = season_key(now)
    for old in db.scalars(select(LeaderboardSeason).where(LeaderboardSeason.key < key, LeaderboardSeason.closed_at.is_(None))):
        # Never query present-day source state or user eligibility while closing.
        old.closed_at = now
    current = db.get(LeaderboardSeason, key)
    if current is None:
        current = LeaderboardSeason(key=key, rules=season_rules(), roster=roster(db), created_at=now, updated_at=now)
        db.add(current)
        db.flush()
    else:
        current.roster = roster(db)
    return current


def require_season(db: Session, key: str) -> LeaderboardSeason:
    season = db.get(LeaderboardSeason, key)
    if season is None:
        raise HTTPException(404, "Сезон не найден")
    return season


def require_active(season: LeaderboardSeason, now: datetime | None = None):
    if season.closed_at is not None or season.key != season_key(now):
        raise HTTPException(409, "Сезон закрыт. Используйте явную историческую корректировку с причиной.")


def ranking(db: Session, season: LeaderboardSeason) -> list[dict]:
    totals = dict(db.execute(select(LeaderboardContribution.participant_id, func.sum(LeaderboardContribution.points)).where(
        LeaderboardContribution.season == season.key, LeaderboardContribution.eligible.is_(True)
    ).group_by(LeaderboardContribution.participant_id)).all())
    rows = [{**person, "points": totals.get(person["id"], 0)} for person in season.roster]
    rows.sort(key=lambda row: (-row["points"], row["name"].casefold(), row["id"]))
    previous, rank = None, 0
    for index, row in enumerate(rows, 1):
        if row["points"] != previous:
            rank = index
        row["rank"] = rank
        previous = row["points"]
    return rows


def contribution_read(row: LeaderboardContribution, admin: bool = False) -> dict:
    data = {"id": row.id, "participant_id": row.participant_id, "source": row.source,
            "source_key": row.source_key, "event_type": row.event_type,
            "date": utc_iso_z(row.source_at), "points": row.points if row.eligible else 0,
            "eligible": row.eligible, "explanation": row.explanation}
    if admin:
        data["evidence"] = row.evidence
    return data


def audit(db: Session, admin_id: int, action: str, reason: str, details: dict, season: str | None = None):
    db.add(LeaderboardAudit(admin_id=admin_id, action=action, reason=reason, details=details, season=season))


def apply_source(db: Session, season: LeaderboardSeason, source: str, events: list[dict], now: datetime | None = None):
    """Replace only a successfully fetched complete source snapshot, never on failure."""
    now = now or datetime.utcnow()
    require_active(season, now)
    people = {p["id"] for p in season.roster}
    existing = {(r.source_key, r.participant_id, r.event_type): r for r in db.scalars(
        select(LeaderboardContribution).where(LeaderboardContribution.season == season.key, LeaderboardContribution.source == source))}
    seen = set()
    for event in events:
        if season_key(event["source_at"]) != season.key:
            continue
        identity = (event["source_key"], event["participant_id"], event["event_type"])
        if identity in seen:
            continue
        seen.add(identity)
        row = existing.get(identity)
        if row is None:
            row = LeaderboardContribution(season=season.key, source=source, source_key=identity[0], participant_id=identity[1], event_type=identity[2])
            db.add(row)
        rule = season.rules["events"].get(event["event_type"])
        count = int(event.get("count", 0))
        points = rule["points"] if rule else execution_points(count, season.rules)
        row.source_at = event["source_at"]
        row.eligible = bool(event.get("eligible", True) and identity[1] in people and points > 0)
        row.points = points
        row.explanation = rule["label"] if rule else f"Выполнено {count} тестов в run"
        row.evidence = event.get("evidence", {})
        row.updated_at = now
    for identity, row in existing.items():
        if identity not in seen:
            row.eligible = False
            row.updated_at = now
    season.updated_at = now
    db.flush()


def execution_events(rows: list[dict], rules: dict) -> list[dict]:
    """Inputs are individually identified, attributed and timestamped executions."""
    grouped = defaultdict(dict)
    for row in rows:
        if row["status"] not in rules["execution_statuses"] or row.get("participant_id") is None:
            continue
        key = (str(row["run_id"]), row["participant_id"], season_key(row["source_at"]))
        grouped[key][str(row["id"])] = row
    return [{"source_key": run, "participant_id": person, "event_type": "TEST_EXECUTION",
             "source_at": max(r["source_at"] for r in results.values()), "count": len(results),
             "evidence": {"run_id": run, "execution_ids": sorted(results), "count": len(results)}}
            for (run, person, _month), results in grouped.items()]


def replace_bugs(db: Session, season: LeaderboardSeason, candidates: list[dict], now: datetime | None = None):
    require_active(season, now)
    existing = {b.source_key: b for b in db.scalars(select(LeaderboardBug).where(LeaderboardBug.season == season.key))}
    seen = set()
    for candidate in candidates:
        if season_key(candidate["source_at"]) != season.key:
            continue
        key = candidate["source_key"]
        seen.add(key)
        bug = existing.get(key)
        if bug is None:
            bug = LeaderboardBug(season=season.key, source_key=key, status="pending")
            db.add(bug)
        # Confirmation is tied to reviewed ownership and environment. A material
        # correction requires a new review instead of transferring approval.
        if bug.status == "confirmed" and (bug.participant_id != candidate["participant_id"] or bug.environment != candidate["environment"]):
            bug.status = "pending"
        for field in ("issue_key", "participant_id", "source_at", "environment", "problem", "evidence"):
            setattr(bug, field, candidate[field])
        bug.updated_at = now or datetime.utcnow()
    for key, bug in existing.items():
        if key not in seen:
            bug.problem = "Задача удалена или больше не входит в область Jira"
    db.flush()
    score_bugs(db, season, now)


def score_bugs(db: Session, season: LeaderboardSeason, now: datetime | None = None):
    events = []
    for bug in db.scalars(select(LeaderboardBug).where(LeaderboardBug.season == season.key)):
        if bug.participant_id is None or bug.environment not in {"DEV", "STAGE"}:
            continue
        events.append({"source_key": bug.source_key, "participant_id": bug.participant_id,
                       "event_type": f"BUG_{bug.environment}_CONFIRMED", "source_at": bug.source_at,
                       "eligible": bug.status == "confirmed" and not bug.problem,
                       "evidence": {"issue_key": bug.issue_key, "environment": bug.environment, "approval": bug.status}})
    apply_source(db, season, "jira", events, now)


def adjust(db: Session, season: LeaderboardSeason, participant_id: int, points: int, reason: str, admin_id: int, historical: bool):
    if not reason.strip() or not points:
        raise HTTPException(422, "Укажите ненулевую корректировку и причину")
    if season.key != season_key() and not historical:
        raise HTTPException(409, "Подтвердите изменение закрытого сезона")
    if participant_id not in {p["id"] for p in season.roster}:
        raise HTTPException(422, "Пользователь не участвовал в этом сезоне")
    row = LeaderboardContribution(season=season.key, participant_id=participant_id, source="manual", source_key=str(uuid4()),
                                  event_type="MANUAL_ADJUSTMENT", source_at=datetime.utcnow(), points=points, eligible=True,
                                  explanation=f"Корректировка: {reason.strip()}", evidence={"admin_id": admin_id, "historical": historical})
    db.add(row)
    db.flush()
    audit(db, admin_id, "manual_adjustment", reason.strip(), {"contribution_id": row.id, "participant_id": participant_id, "points": points}, season.key)
    season.updated_at = datetime.utcnow()
    return row
