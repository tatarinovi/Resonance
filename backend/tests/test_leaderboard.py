from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import User, UserRole, LeaderboardContribution, LeaderboardSeason
from app.leaderboard_rules import eligible, execution_points, season_rules
from app.leaderboard_service import (ensure_current, apply_source, ranking, execution_events, replace_bugs,
                                     score_bugs, adjust)


@pytest.fixture
def db():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()


def users(db):
    rows = [User(username=name, password_hash='x', role=role, direction=direction, workspace=workspace)
            for name, role, direction, workspace in [('Alice', UserRole.EMPLOYEE, 'qa', 'ds'), ('Bob', UserRole.EMPLOYEE, 'qa', 'ds'), ('Admin', UserRole.ADMIN, 'qa', 'ds'), ('Nota', UserRole.EMPLOYEE, 'qa', 'nota'), ('Other', UserRole.EMPLOYEE, 'back', 'ds')]]
    db.add_all(rows)
    db.flush()
    return rows


@pytest.mark.parametrize('count,points', [(0,0),(1,1),(25,1),(26,2),(75,2),(76,3),(150,3),(151,4),(250,4),(251,5)])
def test_tiers(count, points):
    assert execution_points(count, season_rules()) == points


def test_eligibility_and_zero_ranking(db):
    rows = users(db)
    assert [eligible(u) for u in rows] == [True, True, False, False, False]
    season = ensure_current(db, datetime(2026,9,10))
    assert [(p['name'],p['points'],p['rank']) for p in ranking(db, season)] == [('Alice',0,1), ('Bob',0,1)]
    rows[0].projects = []
    assert len(ensure_current(db, datetime(2026,9,11)).roster) == 2
    rows[0].workspace = 'nota'
    assert len(ensure_current(db, datetime(2026,9,12)).roster) == 1


def test_creation_state_idempotency_freeze_and_month_boundary(db):
    a, *_ = users(db)
    september = datetime(2026,9,10)
    season = ensure_current(db, september)
    event = dict(source_key='case-1', participant_id=a.id, event_type='TEST_CASE_CREATED', source_at=september)
    for _ in range(10):
        apply_source(db, season, 'testops_cases', [event], september)
    assert db.scalar(select(LeaderboardContribution)).points == 1
    assert ranking(db,season)[0]['points'] == 1
    apply_source(db,season,'testops_cases',[{**event,'eligible':False}],september)
    assert ranking(db,season)[0]['points'] == 0
    apply_source(db,season,'testops_cases',[event],september)
    october = datetime(2026,9,30,21)  # midnight Moscow
    current = ensure_current(db,october)
    assert current.key == '2026-10'
    apply_source(db,current,'testops_cases',[event],october)
    assert ranking(db,current)[0]['points'] == 0
    assert ranking(db,season)[0]['points'] == 1
    with pytest.raises(HTTPException):
        apply_source(db,season,'testops_cases',[],october)
    a.workspace = 'nota'
    ensure_current(db,october)
    assert len(season.roster) == 2


def test_execution_grouping_updates_and_failures_count(db):
    a,b,*_ = users(db)
    now = datetime(2026,9,10)
    season = ensure_current(db,now)
    rows = [dict(id=i,run_id='run',participant_id=a.id,source_at=now,status='failed') for i in range(26)]
    rows += [dict(id=100,run_id='run',participant_id=b.id,source_at=now,status='blocked'),
             dict(id=101,run_id='run',participant_id=b.id,source_at=now,status='skipped'),
             dict(id=102,run_id='run',participant_id=b.id,source_at=datetime(2026,10,1),status='passed')]
    events = execution_events(rows+rows,season.rules)
    assert len(events) == 3
    for _ in range(2):
        apply_source(db,season,'testops_runs',events,now)
    assert [p['points'] for p in ranking(db,season)] == [2,1]
    apply_source(db,season,'testops_runs',execution_events(rows[1:],season.rules),now)
    assert [p['points'] for p in ranking(db,season)] == [1,1]
    assert [p['rank'] for p in ranking(db,season)] == [1,1]


def test_bug_confirmation_change_and_rejection(db):
    a,b,*_ = users(db)
    now = datetime(2026,9,10)
    season = ensure_current(db,now)
    candidate = dict(source_key='1',issue_key='BUG-1',participant_id=a.id,source_at=now,environment='DEV',problem=None,evidence={})
    replace_bugs(db,season,[candidate],now)
    from app.models import LeaderboardBug
    bug = db.scalar(select(LeaderboardBug))
    assert ranking(db,season)[0]['points'] == 0
    bug.status = 'confirmed'
    db.flush()
    score_bugs(db,season,now)
    assert ranking(db,season)[0]['points'] == 4
    replace_bugs(db,season,[candidate],now)
    assert ranking(db,season)[0]['points'] == 4
    replace_bugs(db,season,[{**candidate,'environment':'STAGE'}],now)
    assert bug.status == 'pending'
    assert ranking(db,season)[0]['points'] == 0
    bug.status = 'confirmed'
    db.flush()
    score_bugs(db,season,now)
    assert ranking(db,season)[0]['points'] == 2
    bug.status = 'rejected'
    db.flush()
    score_bugs(db,season,now)
    assert ranking(db,season)[0]['points'] == 0
    replace_bugs(db,season,[],now)
    assert bug.problem


def test_kanban_uses_resonance_epic_estimate_and_real_worklogs(db):
    from app.models import Epic
    from app.leaderboard_sources import kanban_events
    a,b,*_ = users(db)
    lead = User(id=99, username='Lead', role=UserRole.COORDINATOR, direction='qa', workspace='ds')
    epic = Epic(id=1, qa_estimate_hours=2, qa_member_ids=[a.id])
    estimates = [dict(id=1,user_id=10,estimate=120,is_actual=True,created_at='2026-09-10T10:00:00Z'),
                 dict(id=2,user_id=20,estimate=120,is_actual=True,created_at='2026-09-09T10:00:00Z')]
    logs = [dict(time=60,begin='2026-09-10T09:00:00Z'),dict(time=60,begin='2026-09-10T10:00:00Z')]
    events, _ = kanban_events(epic,logs,estimates,{a.id:a,99:lead},{'10':a.id,'20':99})
    season = ensure_current(db,datetime(2026,9,10))
    for _ in range(3):
        apply_source(db,season,'kanban',events,datetime(2026,9,10))
    assert ranking(db,season)[0]['points'] == 15
    epic.qa_estimate_hours = None
    estimates[0]['estimate'] = estimates[1]['estimate'] = None
    events, _ = kanban_events(epic,logs,estimates,{a.id:a,99:lead},{'10':a.id,'20':99})
    apply_source(db,season,'kanban',events,datetime(2026,9,10))
    assert ranking(db,season)[0]['points'] == 0
    epic.qa_estimate_hours = 2
    events, _ = kanban_events(epic,[],estimates,{a.id:a,99:lead},{'10':a.id,'20':99})
    assert events == []


@pytest.mark.parametrize('fields,expected', [({'summary':'DEV bug'},'DEV'),({'summary':'STAGE bug'},'STAGE'),({'summary':'DEV STAGE bug'},None),({'summary':'DEVICE defect'},None),({'summary':'DEV','environment':'STAGE'},'STAGE'),({'summary':'DEV','environment':'production'},None)])
def test_environment_is_conservative(fields,expected):
    from app.leaderboard_sources import bug_environment
    assert bug_environment(fields) == expected


def test_private_activity_and_cross_project_api(db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.pool import StaticPool
    from app.database import get_db
    from app.deps import get_current_user
    from app.routers.leaderboard import router
    from app.models import Project
    engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine,expire_on_commit=False)() as session:
        a,b,admin,nota,other = users(session)
        a.projects = [Project(name='A')]
        b.projects = [Project(name='B')]
        session.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: a
        client = TestClient(app)
        response = client.get('/leaderboard')
        assert response.status_code == 200
        assert len(response.json()['items']) == 2
        key = response.json()['season']
        assert client.get(f'/leaderboard/activity?season={key}&participant_id={b.id}').status_code == 403
        assert client.get(f'/leaderboard/admin?season={key}').status_code == 403
        assert client.post('/leaderboard/sync').status_code == 403
        app.dependency_overrides[get_current_user] = lambda: admin
        assert client.get(f'/leaderboard/activity?season={key}&participant_id={b.id}').status_code == 200
        body = {'participant_id':a.id,'points':4,'reason':'Verified missing bug'}
        assert client.post(f'/leaderboard/seasons/{key}/adjustments',json=body).status_code == 200
        assert client.get('/leaderboard').json()['items'][0]['points'] == 4
        assert len(client.get(f'/leaderboard/admin?season={key}').json()['audit']) == 1
        body['reason'] = '   '
        assert client.post(f'/leaderboard/seasons/{key}/adjustments',json=body).status_code == 422
        app.dependency_overrides[get_current_user] = lambda: nota
        assert client.get('/leaderboard').status_code == 403


def test_historical_adjustment_requires_explicit_action_and_keeps_evidence(db):
    from app.models import LeaderboardAudit
    a,*_ = users(db)
    season = LeaderboardSeason(key='2020-01',rules=season_rules(),roster=[{'id':a.id,'name':a.username}],closed_at=datetime(2020,2,1))
    db.add(season)
    db.flush()
    with pytest.raises(HTTPException):
        adjust(db,season,a.id,4,'Outage',10,False)
    adjust(db,season,a.id,4,'Outage',10,True)
    adjust(db,season,a.id,-2,'Correction',10,True)
    db.flush()
    assert ranking(db,season)[0]['points'] == 2
    assert len(list(db.scalars(select(LeaderboardAudit)))) == 2
    assert season.closed_at == datetime(2020,2,1)


def test_source_failure_keeps_successful_points(db,monkeypatch):
    from app import leaderboard_sync as sync
    from app.models import AppSetting
    a,*_ = users(db)
    now = datetime.utcnow()
    season = ensure_current(db,now)
    apply_source(db,season,'testops_cases',[dict(source_key='1',participant_id=a.id,source_at=now,event_type='TEST_CASE_CREATED')])
    db.commit()
    factory = sessionmaker(bind=db.bind,expire_on_commit=False)
    monkeypatch.setattr(sync,'SessionLocal',factory)
    monkeypatch.setattr(sync,'kanban_data',lambda *args:([],[]))
    monkeypatch.setattr(sync,'jira_candidates',lambda *args:([],[]))
    def fail(*args):
        raise TimeoutError('Never expose raw upstream errors')
    monkeypatch.setattr(sync,'testops_data',fail)
    sync.sync_leaderboard(True)
    db.expire_all()
    assert ranking(db,db.get(LeaderboardSeason,season.key))[0]['points'] == 1
    state = db.get(AppSetting,'leaderboard_sync').value_json
    assert state['status'] == 'complete'
    assert state['sources']['testops']['status'] == 'failed'
    assert 'Never expose' not in str(state)


def test_pagination_does_not_accept_truncated_or_duplicate_pages():
    import httpx
    from app.leaderboard_sources import pages, SourceProblem
    import time
    payload = {'content':[{'id':1}], 'totalElements':2}
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as client:
        with pytest.raises(SourceProblem):
            pages(client,'https://testops','/testcase',{},time.monotonic()+5)
    payload = {'content':[{'id':i} for i in range(100)],'totalElements':201}
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as client:
        with pytest.raises(SourceProblem):
            pages(client,'https://testops','/testcase',{},time.monotonic()+5)


def test_explicit_backfill_freezes_and_does_not_rewrite_existing_history(db,monkeypatch):
    from app import leaderboard_sync as sync
    from app.models import AppSetting, LeaderboardAudit
    a,*_ = users(db)
    db.commit()
    monkeypatch.setattr(sync,'SessionLocal',sessionmaker(bind=db.bind,expire_on_commit=False))
    monkeypatch.setattr(sync,'kanban_data',lambda *args:([],[]))
    monkeypatch.setattr(sync,'jira_candidates',lambda *args:([],[]))
    event = dict(source_key='case',participant_id=a.id,source_at=datetime(2020,1,5),event_type='TEST_CASE_CREATED')
    monkeypatch.setattr(sync,'testops_data',lambda *args:([event],[],[]))
    sync.backfill_leaderboard('2020-01','Initial import',100)
    db.expire_all()
    season = db.get(LeaderboardSeason,'2020-01')
    assert season.closed_at is not None
    assert ranking(db,season)[0]['points'] == 1
    assert db.get(AppSetting,'leaderboard_backfill').value_json['status'] == 'success'
    assert db.scalar(select(LeaderboardAudit)).action == 'historical_import'
    monkeypatch.setattr(sync,'testops_data',lambda *args:([],[],[]))
    sync.backfill_leaderboard('2020-01','Duplicate import',100)
    db.expire_all()
    assert ranking(db,season)[0]['points'] == 1
    assert db.get(AppSetting,'leaderboard_backfill').value_json['status'] == 'failed'


def test_backfill_failure_is_atomic_and_restart_resumes_request(db,monkeypatch):
    from app import leaderboard_sync as sync
    from app.models import AppSetting
    users(db)
    db.add(AppSetting(key='leaderboard_backfill',value_json={'status':'running','season':'2020-02','reason':'Recovery','admin_id':100}))
    db.commit()
    monkeypatch.setattr(sync,'SessionLocal',sessionmaker(bind=db.bind,expire_on_commit=False))
    monkeypatch.setattr(sync,'kanban_data',lambda *args:([],[]))
    def fail(*args):
        raise TimeoutError()
    monkeypatch.setattr(sync,'jira_candidates',fail)
    sync.resume_backfill()
    db.expire_all()
    assert db.get(LeaderboardSeason,'2020-02') is None
    assert db.get(AppSetting,'leaderboard_backfill').value_json['status'] == 'failed'


def test_testops_adapter_authorship_statuses_and_cross_month_dates(db,monkeypatch):
    import httpx,time
    from contextlib import contextmanager
    from app import leaderboard_sources as source
    from app.models import Epic,Project,EpicTestRun,LeaderboardIdentity
    a,b,*_ = users(db)
    project = Project(name='Source scope')
    db.add(project);db.flush()
    epic = Epic(project_id=project.id,title='E',jira_url='',confluence_url='')
    db.add(epic);db.flush()
    db.add(EpicTestRun(id=1,epic_id=epic.id,environment='test',status='passed',url='https://testops/launch/1',testops_launch_id='1'))
    db.add_all([LeaderboardIdentity(source='testops',external_id='qa-a',user_id=a.id),LeaderboardIdentity(source='testops',external_id='qa-b',user_id=b.id)])
    db.flush()
    now = datetime(2026,9,10)
    cases = [dict(id=i,createdBy='qa-a',createdDate='2026-09-05T00:00:00Z',status={'name':state}) for i,state in enumerate(['active','draft','outdated','deleted','archived'],1)]
    cases.append(dict(id=10,createdBy='qa-a',createdDate='2026-08-05T00:00:00Z',status={'name':'active'}))
    results = [dict(id=i,status=state,testedBy='qa-a',stop='2026-09-05T00:00:00Z') for i,state in enumerate(['passed','failed','blocked','skipped','unknown','broken'],1)]
    results.extend([dict(id=10,status='failed',testedBy='qa-b',stop='2026-09-05T00:00:00Z'),dict(id=11,status='passed',testedBy='qa-a',stop='2026-10-01T00:00:00Z')])
    def respond(request):
        if request.url.path == '/api/rs/launch/1':
            return httpx.Response(200,json={'id':1,'projectId':3})
        rows = results if request.url.path == '/api/rs/testresult' else cases
        return httpx.Response(200,json={'content':rows,'last':True,'totalElements':len(rows)})
    @contextmanager
    def client(*args):
        with httpx.Client(transport=httpx.MockTransport(respond)) as http:
            yield 'https://testops',http
    monkeypatch.setattr(source,'connection_client',client)
    season = ensure_current(db,now)
    case_events,execution,diagnostics = source.testops_data(db,season,time.monotonic()+10)
    assert diagnostics == []
    assert sorted(e['count'] for e in execution) == [1,1,3]
    apply_source(db,season,'testops_cases',case_events,now)
    apply_source(db,season,'testops_runs',execution,now)
    assert [p['points'] for p in ranking(db,season)] == [2,1]
    cases[0]['status']['name'] = 'outdated'
    case_events,_,_ = source.testops_data(db,season,time.monotonic()+10)
    apply_source(db,season,'testops_cases',case_events,now)
    assert [p['points'] for p in ranking(db,season)] == [1,1]


def test_jira_date_filter_preserves_sort_and_quoted_text():
    from app.leaderboard_sources import dated_jql
    assert dated_jql('project = DS ORDER BY created DESC','2026-09-01') == '(project = DS) AND created >= "2026-09-01" ORDER BY created DESC'
    assert dated_jql('summary ~ "ORDER BY"','2026-09-01') == '(summary ~ "ORDER BY") AND created >= "2026-09-01"'
