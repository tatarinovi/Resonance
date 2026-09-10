"""Bounded source reads using Resonance's global integration connections.

Missing attribution is a diagnostic, never a fuzzy name match. Only complete,
validated API snapshots may retire previous active-season contributions.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import re
import time

import httpx
from sqlalchemy import select

from .config import get_settings
from .integration_service import decrypt_secret, get_connection
from .leaderboard_service import execution_events
from .models import AppSetting, Epic, EpicTestRun, LeaderboardIdentity
from .epic_testops_service import parse_testops_launch_id, _status


class SourceProblem(Exception):
    pass


def timestamp(value) -> datetime | None:
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value / 1000, timezone.utc).replace(tzinfo=None)
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            # Existing source adapters treat naive source dates as UTC.
            return parsed
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def external_identity(value) -> str | None:
    if isinstance(value, dict):
        value = value.get('accountId') or value.get('key') or value.get('username') or value.get('name')
    return str(value).strip() if value is not None and str(value).strip() else None


def identity_map(db, source):
    return {r.external_id: r.user_id for r in db.scalars(select(LeaderboardIdentity).where(LeaderboardIdentity.source == source))}


def source_settings(db):
    row = db.get(AppSetting, 'leaderboard_source_settings')
    return row.value_json if row else {}


@contextmanager
def connection_client(db, source):
    connection = get_connection(db, source)
    if not connection.endpoint:
        raise SourceProblem('Интеграция не настроена')
    secret = decrypt_secret(db, connection)
    if source == 'jira':
        auth = (connection.username or '', secret) if connection.auth_type == 'basic' else None
        headers = {} if auth else {'Authorization': f'Bearer {secret}'}
    else:
        auth, headers = None, {'Authorization': f'Api-Token {secret}'}
    with httpx.Client(auth=auth, headers={**headers, 'Accept': 'application/json'}) as client:
        yield connection.endpoint.rstrip('/'), client


def get_json(client, endpoint, path, params, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SourceProblem('Превышен бюджет времени синхронизации')
    response = client.get(endpoint + path, params=params, timeout=min(30, remaining))
    response.raise_for_status()
    return response.json()


def pages(client, endpoint, path, params, deadline, *, jira=False):
    rows, seen = [], set()
    for page in range(200):
        query = {**params, **({'startAt': len(rows), 'maxResults': 100} if jira else {'page': page, 'size': 100})}
        payload = get_json(client, endpoint, path, query, deadline)
        if not isinstance(payload, dict):
            raise SourceProblem('API не вернул страницу с метаданными пагинации')
        batch = payload.get('issues' if jira else 'content')
        if not isinstance(batch, list) or any(not isinstance(item, dict) or item.get('id') is None for item in batch):
            raise SourceProblem('Некорректный ответ API: отсутствуют стабильные ID')
        for item in batch:
            key = str(item['id'])
            if key in seen:
                raise SourceProblem('API повторяет записи между страницами; снимок не применён')
            seen.add(key)
        rows.extend(batch)
        total = payload.get('total' if jira else 'totalElements')
        if total is None and not isinstance(payload.get('last'), bool):
            raise SourceProblem('API не подтвердил полноту выборки; снимок не применён')
        if isinstance(total, int) and len(rows) >= total:
            return rows
        if payload.get('last') is True:
            return rows
        if not batch or len(batch) < 100:
            if payload.get('last') is False or (isinstance(total, int) and len(rows) < total):
                raise SourceProblem('API вернул неполную выборку')
            return rows
    raise SourceProblem('Превышен предел 20 000 записей; сузьте область источника')


def bug_environment(fields):
    structured = fields.get('environment')
    if isinstance(structured, dict):
        structured = structured.get('value') or structured.get('name')
    text = str(structured).strip() if structured else str(fields.get('summary') or '')
    found = set(re.findall(r'(?<![\w])(?:DEV|STAGE)(?![\w])', text.upper()))
    return next(iter(found)) if len(found) == 1 else None


def dated_jql(query, start):
    # Existing Epic JQLs commonly include a final ORDER BY clause. Keep that
    # clause outside the additional date predicate, respecting quoted strings.
    quote, escaped, split_at = None, False, None
    for index, char in enumerate(query):
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
        elif quote:
            if char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif (index == 0 or query[index - 1].isspace()) and re.match(r'ORDER\s+BY\b', query[index:], re.I):
            split_at = index
            break
    predicate = query[:split_at].strip() if split_at is not None else query.strip()
    order = ' ' + query[split_at:] if split_at is not None else ''
    return f'({predicate}) AND created >= "{start}"{order}'


def jira_candidates(db, season, deadline):
    mappings = identity_map(db, 'jira')
    config = source_settings(db)
    queries = sorted({e.jira_jql.strip() for e in db.scalars(select(Epic)) if e.jira_jql and e.jira_jql.strip()})
    if config.get('jira_jql', '').strip():
        queries = [config['jira_jql'].strip()]
    environment_field = config.get('jira_environment_field', 'environment')
    if not queries:
        raise SourceProblem('Нет эпиков с Jira JQL; область импорта не настроена')
    issues, diagnostics = {}, []
    with connection_client(db, 'jira') as (endpoint, client):
        for query in queries:
            # One-day overlap avoids Jira account-timezone distortion. Membership
            # in the month is decided from the returned source timestamp.
            start = (datetime.strptime(season.key, '%Y-%m') - timedelta(days=1)).strftime('%Y-%m-%d')
            rows = pages(client, endpoint, '/rest/api/2/search',
                         {'jql': dated_jql(query, start),
                          'fields': f'summary,issuetype,reporter,creator,created,{environment_field}'}, deadline, jira=True)
            for row in rows:
                issues[str(row['id'])] = row
    candidates = []
    for key, row in issues.items():
        fields = row.get('fields')
        if not isinstance(fields, dict):
            raise SourceProblem('Jira не вернул поля задачи')
        kind = str((fields.get('issuetype') or {}).get('name') or '').casefold()
        if kind not in {'bug', 'баг', 'ошибка', 'дефект'}:
            continue
        created = timestamp(fields.get('created'))
        if created is None:
            raise SourceProblem('Jira bug не содержит достоверную дату создания')
        author = external_identity(fields.get('reporter'))
        person = mappings.get(author)
        environment = bug_environment({**fields, 'environment': fields.get(environment_field)})
        problems = []
        if person is None:
            problems.append('Нет сопоставления автора Jira: ' + (author or 'автор не указан'))
        if environment is None:
            problems.append('Окружение DEV/STAGE отсутствует или неоднозначно')
        if problems:
            diagnostics.append({'source_key': str(row.get('key') or key), 'message': '; '.join(problems)})
        candidates.append({'source_key': key, 'issue_key': str(row.get('key') or key), 'source_at': created,
                           'participant_id': person, 'environment': environment, 'problem': '; '.join(problems) or None,
                           'evidence': {'author': author, 'summary': str(fields.get('summary') or '')[:1000]}})
    return candidates, diagnostics


def testops_data(db, season, deadline):
    mappings = identity_map(db, 'testops')
    configured_projects = source_settings(db).get('testops_project_ids') or []
    launches = sorted({str(run.testops_launch_id or parse_testops_launch_id(run.url))
                       for run in db.scalars(select(EpicTestRun)) if run.testops_launch_id or parse_testops_launch_id(run.url)})
    if not launches and not configured_projects:
        raise SourceProblem('Нет связанных TestOps launches; область импорта не настроена')
    projects, executions, cases, diagnostics = set(), [], {}, []
    with connection_client(db, 'testops') as (endpoint, client):
        projects.update(str(p) for p in configured_projects)
        for project in configured_projects:
            # Explicit project scope also includes runs not linked to an Epic.
            launches.extend(str(row['id']) for row in pages(client, endpoint, '/api/rs/launch', {'projectId': project}, deadline))
        launches = sorted(set(launches))
        for launch_id in launches:
            launch = get_json(client, endpoint, f'/api/rs/launch/{launch_id}', {}, deadline)
            project_id = launch.get('projectId') if isinstance(launch, dict) else None
            if project_id is None and isinstance(launch, dict) and isinstance(launch.get('project'), dict):
                project_id = launch['project'].get('id')
            if project_id is None:
                raise SourceProblem('TestOps launch не содержит projectId для чтения тест-кейсов')
            projects.add(str(project_id))
            for row in pages(client, endpoint, '/api/rs/testresult', {'launchId': launch_id}, deadline):
                state = _status(row.get('status'))
                if state not in season.rules['execution_statuses']:
                    continue
                author = external_identity(row.get('testedBy'))
                executed = timestamp(row.get('stop'))
                if author is None or executed is None:
                    detail = get_json(client, endpoint, f'/api/rs/testresult/{row["id"]}', {}, deadline)
                    author = external_identity(detail.get('testedBy'))
                    executed = timestamp(detail.get('stop'))
                person = mappings.get(author)
                if person is None or executed is None:
                    diagnostics.append({'source_key': f'result:{row["id"]}', 'message': f'Нет сопоставления testedBy ({author or "не указан"}) или даты исполнения stop'})
                    continue
                executions.append({'id': row['id'], 'run_id': launch_id, 'participant_id': person, 'source_at': executed, 'status': state})
        for project in projects:
            for row in pages(client, endpoint, '/api/rs/testcase', {'projectId': project}, deadline):
                cases[str(row['id'])] = row
    events = []
    for key, row in cases.items():
        author = external_identity(row.get('createdBy'))
        created = timestamp(row.get('createdDate'))
        person = mappings.get(author)
        if person is None or created is None:
            diagnostics.append({'source_key': f'case:{key}', 'message': f'Нет сопоставления createdBy ({author or "не указан"}) или даты создания'})
            continue
        events.append({'source_key': key, 'participant_id': person, 'source_at': created, 'event_type': 'TEST_CASE_CREATED',
                       'eligible': _status(row.get('status')) == 'active' and not row.get('deleted') and not row.get('archived'),
                       'evidence': {'name': str(row.get('name') or '')[:1000], 'status': _status(row.get('status')), 'author': author}})
    return events, execution_events(executions, season.rules), diagnostics


def comparable(value):
    from decimal import Decimal, InvalidOperation
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number > 0 else None
    except InvalidOperation:
        return None


def kanban_events(epic, worklogs, estimates, people, mappings):
    """Epic QA total vs Resonance estimate; Lead identity comes from Resonance.

    is_actual only selects the latest estimate, never serves as spent time.
    The caller supplies the same QA-role-filtered worklogs as analytics.
    """
    from .leaderboard_rules import eligible
    from .models import UserRole
    events, diagnostics = [], []
    dated = [(row, timestamp(row.get('begin'))) for row in worklogs]
    if any(date is None for _row, date in dated):
        raise SourceProblem('QA worklog не содержит достоверную дату begin')
    estimate = comparable(epic.qa_estimate_hours)
    minutes = sum((comparable(row.get('time')) or 0) for row, _date in dated)
    latest = max((date for _row, date in dated), default=None)
    participants = [people[uid] for uid in epic.qa_member_ids if uid in people and eligible(people[uid])]
    from decimal import Decimal
    if estimate is not None and latest and minutes > 0:
        # Same two-decimal hour representation as existing Epic analytics.
        matches = (Decimal(minutes) / 60).quantize(Decimal('0.01')) == estimate
        for user in participants:
            events.append({'source_key': f'epic:{epic.id}', 'participant_id': user.id,
                           'event_type': 'QA_ACTUAL_MATCH', 'source_at': latest, 'eligible': matches,
                           'evidence': {'epic_id': epic.id, 'estimate_hours': str(estimate), 'qa_minutes': str(minutes)}})
    selected = {}
    for row in estimates:
        if row.get('is_actual') is not True:
            continue
        person = mappings.get(str(row.get('user_id')))
        if person is None:
            diagnostics.append({'source_key': f'epic:{epic.id}', 'message': f'Нет сопоставления автора оценки Kanban: {row.get("user_id")}'})
            continue
        if person in selected:
            raise SourceProblem('Kanban вернул несколько актуальных оценок одного автора')
        selected[person] = row
    leads = [row for uid, row in selected.items() if uid in people and people[uid].role in {UserRole.COORDINATOR, UserRole.MANAGER} and people[uid].direction == 'qa' and people[uid].workspace == 'ds']
    if len(leads) != 1:
        diagnostics.append({'source_key': f'epic:{epic.id}', 'message': 'Нет единственной оценки Lead QA, сопоставленного с координатором QA DS в Resonance'})
    else:
        lead = comparable(leads[0].get('estimate'))
        for user in participants:
            row = selected.get(user.id)
            if row is None:
                continue
            value = comparable(row.get('estimate'))
            date = timestamp(row.get('created_at'))
            if lead is not None and value is not None and date:
                events.append({'source_key': f'epic:{epic.id}', 'participant_id': user.id,
                               'event_type': 'QA_LEAD_MATCH', 'source_at': date, 'eligible': value == lead,
                               'evidence': {'epic_id': epic.id, 'estimate_minutes': str(value), 'lead_estimate_minutes': str(lead), 'estimate_id': row.get('id'), 'lead_estimate_id': leads[0].get('id')}})
    return events, diagnostics


def kanban_data(db, season, deadline):
    from .integration_service import require_global_kanban_token
    from .kanban_client import KanbanClient, parse_kanban_reference
    from .kanban_member_roles import load_global_role_map, effective_role, KanbanProjectMemberRole
    from .models import User
    from .routers.analytics import _worklog_kanban_user_id
    mappings, people = identity_map(db, 'kanban'), {p.id: p for p in db.scalars(select(User))}
    roles = load_global_role_map(db)
    epics = list(db.scalars(select(Epic).where(Epic.kanban_url.is_not(None))))
    if not epics:
        raise SourceProblem('Нет эпиков со ссылкой Kanban')
    client = KanbanClient(require_global_kanban_token(db), deadline=deadline)
    events, diagnostics = [], []
    with client.pooled_http():
        for epic in epics:
            if not epic.kanban_url:
                continue
            slug, key = parse_kanban_reference(epic.kanban_url)
            detail = client.task(key)
            if not isinstance(detail, dict) or detail.get('id') is None:
                raise SourceProblem('Kanban не вернул эпик')
            tasks = detail.get('epic_by')
            if not isinstance(tasks, list):
                tasks = client.project_list_all(slug, params=[(f'filter[epic_id][{key}]', str(key))])
            ids = {key, *(int(t['id']) for t in tasks)}
            logs = []
            for task_id in sorted(ids):
                for row in client.task_worklogs(task_id):
                    uid = _worklog_kanban_user_id(row)
                    if effective_role(roles, uid) == KanbanProjectMemberRole.QA:
                        logs.append(row)
            rows, problems = kanban_events(epic, logs, detail.get('responsible_estimates') or [], people, mappings)
            events.extend(rows)
            diagnostics.extend(problems)
    return events, diagnostics
