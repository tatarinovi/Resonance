"""Source coverage and one canonical release Kanban scope."""
from datetime import datetime, timedelta
import hashlib
import json
from sqlalchemy import select, func
from .models import ScopedAnalyticsSnapshot, EpicExternalSyncState, EpicTestOpsSnapshot, EpicJiraIssue
from .kanban_client import parse_kanban_reference


def freshness(success=None, attempt=None, failed=False, message=None, refreshing=False, configured=True):
    status = ("refreshing" if refreshing else "not_configured" if not configured else
              "failed" if failed and success else "error" if failed else "empty" if not success else
              "fresh" if success > datetime.utcnow() - timedelta(minutes=10) else "stale")
    return {"status": status, "has_data": success is not None, "last_success_at": success,
            "last_attempt_at": attempt, "message": message, "last_attempt_failed": failed}


def aggregate(details):
    configured = [d for d in details if d['status'] != 'not_configured']
    covered = [d for d in details if d['has_data']]
    states = {d['status'] for d in configured}
    status = ('not_configured' if not configured else 'refreshing' if 'refreshing' in states else
              next(iter(states)) if len(states) == 1 and len(configured) == len(details) else 'partial')
    return {"status": status, "has_data": bool(covered), "covered": len(covered), "total": len(details),
            "last_success_at": min((d['last_success_at'] for d in covered), default=None),
            "details": details}


def kanban_scope(release):
    refs = []
    for membership in release.memberships:
        epic = membership.epic
        if membership.removed_at is not None or not epic or not epic.kanban_url:
            continue
        try:
            slug, task_id = parse_kanban_reference(epic.kanban_url)
            refs.append((epic.id, slug, task_id))
        except ValueError:
            continue
    scope = {"type": "release_overview", "release_id": release.id,
             "refs": sorted(refs)}
    key = hashlib.sha256(json.dumps(scope, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return key, scope, refs


def kanban_source(db, release):
    key, _, refs = kanban_scope(release)
    row = db.get(ScopedAnalyticsSnapshot, key)
    data = freshness(row.last_success_at if row else None, row.last_attempt_at if row else None,
                     row.last_attempt_failed if row else False, row.error_message if row else None,
                     bool(row and row.refresh_started_at), bool(refs))
    return aggregate([{**data, 'label': 'Kanban релиза'}])


def release_sources(db, release, epics):
    states = {(s.epic_id, s.source): s for s in db.scalars(select(EpicExternalSyncState).where(EpicExternalSyncState.epic_id.in_([e.id for e in epics])))}
    jira, testops = [], []
    for epic in epics:
        state = states.get((epic.id, 'jira'))
        cached_at = db.scalar(select(func.max(EpicJiraIssue.refreshed_at)).where(EpicJiraIssue.epic_id == epic.id))
        jira.append({**freshness(state.last_success_at if state and state.last_success_at else cached_at, state.last_attempt_at if state else None,
                      bool(state and state.last_error_code), state.last_error_message if state else None,
                      configured=bool((epic.jira_jql or '').strip())), 'epic_id': epic.id, 'label': epic.title})
        runs = list(epic.test_runs or [])
        for run in runs:
            state = states.get((epic.id, 'testops'))
            snapshot = db.get(EpicTestOpsSnapshot, run.id)
            testops.append({**freshness(snapshot.synced_at if snapshot else None,
                run.sync_attempt_at or (state.last_attempt_at if state else None), bool(run.sync_error) if run.sync_attempt_at else bool(state and state.last_error_code),
                run.sync_error if run.sync_attempt_at else (state.last_error_message if state else None), configured=bool(run.testops_launch_id or run.url)),
                'epic_id': epic.id, 'run_id': run.id, 'label': f'{epic.title} · {run.environment}'})
        if not runs:
            testops.append({**freshness(configured=False), 'epic_id': epic.id, 'label': epic.title})
    return {'jira': aggregate(jira), 'testops': aggregate(testops), 'kanban': kanban_source(db, release)}
