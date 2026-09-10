"""Bounded background synchronization in the existing API process, no extra service."""
import asyncio
from copy import deepcopy
from datetime import datetime
import logging
from threading import Lock
import time

from fastapi import HTTPException
import httpx
from sqlalchemy import text

from .database import SessionLocal
from .datetime_util import utc_iso_z
from .leaderboard_service import apply_source, ensure_current, replace_bugs, serialized
from .leaderboard_sources import SourceProblem, jira_candidates, testops_data, kanban_data
from .models import AppSetting

logger = logging.getLogger(__name__)
_RUN_LOCK = Lock()
_BACKFILL_LOCK = Lock()


def save_state(db, state):
    row = db.get(AppSetting, 'leaderboard_sync')
    if row is None:
        row = AppSetting(key='leaderboard_sync', value_json={})
        db.add(row)
    row.value_json = deepcopy(state)


def safe_error(error):
    if isinstance(error, SourceProblem):
        return str(error)[:500]
    if isinstance(error, httpx.HTTPStatusError):
        return f'Источник вернул HTTP {error.response.status_code}; предыдущие данные сохранены'
    if isinstance(error, (httpx.TimeoutException, TimeoutError)):
        return 'Источник не ответил вовремя; предыдущие данные сохранены'
    if isinstance(error, HTTPException):
        return f'Интеграция недоступна (код {error.status_code}); проверьте настройки'
    return 'Не удалось получить достоверные данные; предыдущий снимок сохранён'


def sync_leaderboard(force=False):
    if not _RUN_LOCK.acquire(blocking=False):
        return
    connection = None
    try:
        # A session-level advisory lock spans source I/O without holding the
        # mutation lock or a database transaction needed by leaderboard reads.
        with SessionLocal() as db:
            if db.bind.dialect.name == 'postgresql':
                connection = db.bind.connect()
                if not connection.execute(text('SELECT pg_try_advisory_lock(824610022)')).scalar():
                    return
                connection.commit()
            with serialized(db):
                season = ensure_current(db)
                saved = db.get(AppSetting, 'leaderboard_sync')
                state = dict(saved.value_json) if saved else {}
                last = state.get('last_attempt_at')
                if not force and last:
                    attempted = datetime.fromisoformat(last.replace('Z', '+00:00')).replace(tzinfo=None)
                    if (datetime.utcnow() - attempted).total_seconds() < 600:
                        return
                state.update(status='running', last_attempt_at=utc_iso_z(datetime.utcnow()))
                save_state(db, state)
            outcomes = dict(state.get('sources') or {})
            for source, fetch in [('kanban', kanban_data), ('jira', jira_candidates), ('testops', testops_data)]:
                previous = outcomes.get(source, {})
                try:
                    data = fetch(db, season, time.monotonic() + 90)
                    with serialized(db):
                        current = ensure_current(db)
                        if current.key != season.key:
                            raise SourceProblem('Сезон сменился во время запроса; данные будут загружены следующим проходом')
                        if source == 'kanban':
                            rows, diagnostics = data
                            apply_source(db, current, 'kanban', rows)
                            count = len(rows)
                        elif source == 'jira':
                            rows, diagnostics = data
                            replace_bugs(db, current, rows)
                            count = len(rows)
                        else:
                            cases, executions, diagnostics = data
                            apply_source(db, current, 'testops_cases', cases)
                            apply_source(db, current, 'testops_runs', executions)
                            count = len(cases) + len(executions)
                    outcomes[source] = {'status': 'partial' if diagnostics else 'success', 'last_success_at': utc_iso_z(datetime.utcnow()),
                                        'count': count, 'problems': diagnostics[:100], 'problem_count': len(diagnostics)}
                except Exception as error:
                    db.rollback()
                    outcomes[source] = {**previous, 'status': 'failed', 'error': safe_error(error)}
                with serialized(db):
                    state = {**state, 'sources': outcomes}
                    save_state(db, state)
            with serialized(db):
                state.update(status='complete', last_finished_at=utc_iso_z(datetime.utcnow()))
                save_state(db, state)
    finally:
        if connection is not None:
            try:
                connection.execute(text('SELECT pg_advisory_unlock(824610022)'))
                connection.commit()
            finally:
                connection.close()
        _RUN_LOCK.release()


async def leaderboard_poll_loop():
    while True:
        try:
            await asyncio.to_thread(sync_leaderboard)
            await asyncio.to_thread(resume_backfill)
        except Exception:
            logger.error('Leaderboard background pass failed; source data retained')
        await asyncio.sleep(60)


def backfill_leaderboard(key, reason, admin_id):
    if not _BACKFILL_LOCK.acquire(blocking=False):
        return
    try:
        _backfill_leaderboard(key, reason, admin_id)
    finally:
        _BACKFILL_LOCK.release()


def resume_backfill():
    # The request survives a process restart; no unbounded startup history scan.
    with SessionLocal() as db:
        row = db.get(AppSetting, 'leaderboard_backfill')
        request = dict(row.value_json) if row else {}
    if request.get('status') == 'running' and request.get('admin_id'):
        backfill_leaderboard(request['season'], request['reason'], request['admin_id'])


def _backfill_leaderboard(key, reason, admin_id):
    """Explicit initial import only. Existing history can only receive adjustments.

    Historical source state and former user eligibility aren't reconstructable
    from these APIs. The administrator acknowledges this in the audited request;
    sources supply real dated records and are snapshotted once at import.
    """
    from .leaderboard_rules import season_rules
    from .leaderboard_service import roster, audit
    from .models import LeaderboardSeason
    with SessionLocal() as db:
        try:
            draft = LeaderboardSeason(key=key, rules=season_rules(), roster=roster(db))
            collected = []
            for source, fetch in [('kanban', kanban_data), ('jira', jira_candidates), ('testops', testops_data)]:
                data = fetch(db, draft, time.monotonic() + 90)
                collected.append((source, data))
            with serialized(db):
                if db.get(LeaderboardSeason, key) is not None:
                    raise SourceProblem('Сезон уже существует; используйте корректировки')
                db.add(draft)
                db.flush()
                reference = datetime.strptime(key + '-15', '%Y-%m-%d')
                for source, data in collected:
                    if source == 'kanban':
                        apply_source(db, draft, source, data[0], reference)
                    elif source == 'jira':
                        replace_bugs(db, draft, data[0], reference)
                    else:
                        apply_source(db, draft, 'testops_cases', data[0], reference)
                        apply_source(db, draft, 'testops_runs', data[1], reference)
                draft.closed_at = datetime.utcnow()
                draft.updated_at = datetime.utcnow()
                audit(db, admin_id, 'historical_import', reason, {
                    'basis': 'Состояние источников и состав участников на дату импорта; историческое состояние не восстановлено',
                    'sources': {source: {'problems': data[-1][:100], 'problem_count': len(data[-1])} for source, data in collected},
                    'jira': 'Кандидаты импортированы без начисления; используйте аудируемую корректировку после проверки',
                }, key)
                save_backfill_state(db, {'status': 'success', 'season': key, 'finished_at': utc_iso_z(datetime.utcnow())})
        except Exception as error:
            db.rollback()
            with serialized(db):
                save_backfill_state(db, {'status': 'failed', 'season': key, 'error': safe_error(error), 'finished_at': utc_iso_z(datetime.utcnow())})


def save_backfill_state(db, value):
    row = db.get(AppSetting, 'leaderboard_backfill')
    if row is None:
        row = AppSetting(key='leaderboard_backfill', value_json={})
        db.add(row)
    row.value_json = deepcopy(value)
