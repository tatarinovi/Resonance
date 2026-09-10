"""Team-wide scores; private source activity is restricted to self and admins."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..datetime_util import utc_iso_z
from ..deps import get_current_user, require_admin
from ..leaderboard_rules import eligible, season_key
from ..leaderboard_schemas import BackfillRequest, BugDecision, IdentityWrite, ManualAdjustment, SourceSettings
from ..leaderboard_service import (adjust, audit, contribution_read, ensure_current, ranking,
                                   require_active, require_season, score_bugs, serialized)
from ..models import (AppSetting, LeaderboardAudit, LeaderboardBug, LeaderboardContribution,
                      LeaderboardIdentity, LeaderboardSeason, User, UserRole)

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.post("/sync", status_code=202)
def synchronize(background: BackgroundTasks, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from ..leaderboard_sync import sync_leaderboard
    with serialized(db):
        current = ensure_current(db)
        audit(db, user.id, "sync_requested", "Ручная синхронизация активного сезона", {}, current.key)
    background.add_task(sync_leaderboard, True)
    return {"accepted": True}


@router.put("/sources")
def configure_sources(body: SourceSettings, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with serialized(db):
        row = db.get(AppSetting, 'leaderboard_source_settings')
        before = row.value_json if row else {}
        if row is None:
            row = AppSetting(key='leaderboard_source_settings', value_json={})
            db.add(row)
        row.value_json = body.model_dump(exclude={'reason'})
        audit(db, user.id, 'source_settings', body.reason, {'before': before, 'after': row.value_json})
    return {'ok': True}


@router.post("/backfill", status_code=202)
def backfill(body: BackfillRequest, background: BackgroundTasks, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from ..leaderboard_sync import backfill_leaderboard, save_backfill_state
    if body.season >= season_key() or not body.acknowledge_current_source_state:
        raise HTTPException(422, "Выберите прошедший месяц и подтвердите ограничения исходных данных")
    with serialized(db):
        if db.get(LeaderboardSeason, body.season):
            raise HTTPException(409, "Сезон уже существует; используйте корректировки")
        state = db.get(AppSetting, 'leaderboard_backfill')
        if state and state.value_json.get('status') == 'running':
            raise HTTPException(409, "Импорт уже выполняется")
        save_backfill_state(db, {'status': 'running', 'season': body.season, 'reason': body.reason, 'admin_id': user.id})
        audit(db, user.id, 'backfill_requested', body.reason, {'acknowledged_current_source_state': True}, body.season)
    background.add_task(backfill_leaderboard, body.season, body.reason, user.id)
    return {"accepted": True}


def require_viewer(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN and not eligible(user):
        raise HTTPException(403, "Рейтинг доступен участникам QA DS и администраторам")
    return user


def prepare(db):
    with serialized(db):
        return ensure_current(db)


@router.get("")
def board(season: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user: User = Depends(require_viewer), db: Session = Depends(get_db)):
    current = prepare(db)
    selected = require_season(db, season or current.key)
    sync = db.get(AppSetting, 'leaderboard_sync')
    source_statuses = {name: state.get('status') for name, state in (sync.value_json.get('sources', {}) if sync else {}).items()}
    return {"season": selected.key, "closed": selected.closed_at is not None,
            "source_statuses": source_statuses if selected.key == current.key else {},
            "rules": selected.rules, "items": ranking(db, selected), "current_user_id": user.id,
            "updated_at": utc_iso_z(selected.updated_at),
            "seasons": list(db.scalars(select(LeaderboardSeason.key).order_by(LeaderboardSeason.key.desc())))}


@router.get("/activity")
def activity(season: str, participant_id: int | None = None, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), user: User = Depends(require_viewer), db: Session = Depends(get_db)):
    target = participant_id if participant_id is not None else user.id
    if user.role != UserRole.ADMIN and target != user.id:
        raise HTTPException(403, "Детальная активность доступна только самому участнику и администратору")
    prepare(db)
    require_season(db, season)
    query = select(LeaderboardContribution).where(LeaderboardContribution.season == season, LeaderboardContribution.participant_id == target)
    count = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(LeaderboardContribution.source_at.desc(), LeaderboardContribution.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [contribution_read(r, user.role == UserRole.ADMIN) for r in rows], "total": count, "page": page, "page_size": page_size}


@router.get("/admin")
def admin_data(season: str, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), user: User = Depends(require_admin), db: Session = Depends(get_db)):
    prepare(db)
    require_season(db, season)
    query = select(LeaderboardBug).where(LeaderboardBug.season == season)
    bugs = db.scalars(query.order_by(LeaderboardBug.status, LeaderboardBug.id).offset((page - 1) * page_size).limit(page_size))
    sync = db.get(AppSetting, "leaderboard_sync")
    backfill_state = db.get(AppSetting, "leaderboard_backfill")
    settings = db.get(AppSetting, "leaderboard_source_settings")
    return {"bugs": {"items": [{"id": b.id, "issue_key": b.issue_key, "participant_id": b.participant_id,
                                  "environment": b.environment, "status": b.status, "problem": b.problem} for b in bugs],
                     "total": db.scalar(select(func.count()).select_from(query.subquery())), "page": page, "page_size": page_size},
            "sync": sync.value_json if sync else {},
            "backfill": backfill_state.value_json if backfill_state else {},
            "settings": settings.value_json if settings else {},
            "users": [{"id": u.id, "name": u.username} for u in db.scalars(select(User).order_by(User.username)) if u.workspace == 'ds' and u.direction == 'qa'],
            "identities": [{"id": i.id, "source": i.source, "external_id": i.external_id, "user_id": i.user_id} for i in db.scalars(select(LeaderboardIdentity).order_by(LeaderboardIdentity.id))],
            "audit": [{"id": a.id, "admin_id": a.admin_id, "action": a.action, "reason": a.reason, "details": a.details, "date": utc_iso_z(a.created_at)} for a in db.scalars(select(LeaderboardAudit).where(LeaderboardAudit.season == season).order_by(LeaderboardAudit.id.desc()).limit(100))]}


@router.post("/bugs/{bug_id}/decision")
def decide(bug_id: int, body: BugDecision, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with serialized(db):
        ensure_current(db)
        bug = db.get(LeaderboardBug, bug_id)
        if not bug:
            raise HTTPException(404, "Кандидат не найден")
        season = require_season(db, bug.season)
        require_active(season)
        if body.status == "confirmed" and (bug.problem or bug.participant_id not in {p["id"] for p in season.roster} or bug.environment not in {"DEV", "STAGE"}):
            raise HTTPException(409, "Сначала устраните проблему окружения или сопоставления автора и синхронизируйте данные")
        previous = bug.status
        bug.status = body.status
        db.flush()
        score_bugs(db, season)
        audit(db, user.id, "bug_decision", body.reason, {"bug_id": bug.id, "before": previous, "after": body.status}, season.key)
    return {"ok": True}


@router.post("/seasons/{season}/adjustments")
def correction(season: str, body: ManualAdjustment, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with serialized(db):
        ensure_current(db)
        row = adjust(db, require_season(db, season), body.participant_id, body.points, body.reason, user.id, body.historical)
    return contribution_read(row, True)


@router.put("/identities")
def identity(body: IdentityWrite, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with serialized(db):
        target = db.get(User, body.user_id)
        if target is None:
            raise HTTPException(404, "Пользователь не найден")
        row = db.scalar(select(LeaderboardIdentity).where(LeaderboardIdentity.source == body.source, LeaderboardIdentity.external_id == body.external_id))
        before = row.user_id if row else None
        if row is None:
            row = LeaderboardIdentity(source=body.source, external_id=body.external_id, user_id=body.user_id)
            db.add(row)
        row.user_id = body.user_id
        audit(db, user.id, "identity_mapping", body.reason, {"source": body.source, "external_id": body.external_id, "before": before, "after": body.user_id})
    return {"ok": True}
