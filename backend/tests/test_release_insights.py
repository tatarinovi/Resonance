from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from app.models import EpicJiraIssue, EpicTestRun, EpicTestOpsSnapshot, EpicTestOpsProblemCase, Release, ReleaseStatus, ScopedAnalyticsSnapshot
from app.release_classification import status_group, priority_group
from app.release_service import build_release_assessment
from app.release_sources import freshness, aggregate, kanban_scope
from app.routers.releases import create_release, transition_release, release_tasks, _release_kanban_details, release_qa_results
from app.schemas import ReleaseCreate, ReleaseTransitionRequest
from tests.test_releases import _session, _data


@pytest.mark.parametrize('name,category,expected', [(' ЗАКРЫТ ',None,'done'),('Закрыто',None,'done'),('Custom','done','done'),('Новое',None,'todo'),('Исправлено   на DEV',None,'review'),('Тестирование заблокировано',None,'blocked'),('Unmapped',None,'unknown'),('Custom','indeterminate','development')])
def test_status_classification(name,category,expected):
    assert status_group(name,category)==expected


def _release(db):
    p,u,e=_data(db)
    created=create_release(ReleaseCreate(project_id=p.id,title='R',epic_ids=[e.id]),u,db)
    return u,e,db.get(Release,created.id)


def _issue(db,e,key='J-1',status='Новое',priority='Блокирующий'):
    row=EpicJiraIssue(epic_id=e.id,jira_issue_key=key,summary='Issue',status=status,priority=priority,browser_url='https://jira/browse/'+key,refreshed_at=datetime.utcnow())
    db.add(row);db.commit();return row


def test_closed_and_reopened_risks_and_priority_counters():
    with _session() as db:
        u,e,r=_release(db);issue=_issue(db,e)
        assert priority_group('  Блокирующий  ')=='blocker'
        assert build_release_assessment(db,r)['summary']['jira']['open_blockers']==1
        issue.status='ЗАКРЫТ';db.commit()
        a=build_release_assessment(db,r)
        assert a['summary']['jira']['open_blockers']==0
        assert not a['key_jira_tasks']
        assert a['summary']['jira']['total']==1
        issue.status='Новое';db.commit()
        assert build_release_assessment(db,r)['summary']['jira']['open_blockers']==1


def test_changed_risks_require_new_acceptance():
    with _session() as db:
        u,e,r=_release(db);r.status=ReleaseStatus.IN_PROGRESS;db.commit();issue=_issue(db,e)
        a=build_release_assessment(db,r,target_status=ReleaseStatus.READY)
        with pytest.raises(HTTPException):
            transition_release(r.id,ReleaseTransitionRequest(target_status='ready'),u,db)
        issue.summary='Changed risk';db.commit()
        with pytest.raises(HTTPException):
            transition_release(r.id,ReleaseTransitionRequest(target_status='ready',accept_risks=True,risk_fingerprint=a['risk_fingerprint']),u,db)
        a=build_release_assessment(db,r,target_status=ReleaseStatus.READY)
        transition_release(r.id,ReleaseTransitionRequest(target_status='ready',accept_risks=True,risk_fingerprint=a['risk_fingerprint']),u,db)
        assert r.status==ReleaseStatus.READY


def test_74_tasks_paginated_and_group_filter():
    with _session() as db:
        u,e,r=_release(db)
        for i in range(74):_issue(db,e,f'J-{i:03}', 'ЗАКРЫТ' if i<55 else 'Новое')
        def page(n,group=None):
            return release_tasks(r.id,q=None,epic_id=None,status_filter=None,priority=None,status_group_filter=group,priority_group_filter=None,sort='priority',assignee=None,issue_type=None,page=n,page_size=25,user=u,db=db)
        assert [len(page(n)['items']) for n in (1,2,3)]==[25,25,24]
        assert len({i['key'] for n in (1,2,3) for i in page(n)['items']})==74
        assert page(1,'done')['total']==55
        assert not page(1)['items'][0]['is_done']


def test_active_run_only_and_same_title_results_preserved():
    with _session() as db:
        u,e,r=_release(db)
        for rid,env in ((1,'test'),(2,'stage')):
            db.add(EpicTestRun(id=rid,epic_id=e.id,environment=env,status='running',testops_launch_id=str(rid)))
            db.flush()
            db.add(EpicTestOpsSnapshot(test_run_id=rid,external_launch_id=str(rid),status='running',total=263,passed=232,failed=20,broken=0,blocked=0,in_progress=11,synced_at=datetime.utcnow()))
            db.flush()
            for n in (1,2):db.add(EpicTestOpsProblemCase(test_run_id=rid,external_result_id=str(n),case_name='Same title',status='failed'))
        db.commit();db.expire_all()
        a=build_release_assessment(db,r)
        assert a['summary']['qa']['completed']==252
        assert a['summary']['qa']['remaining']==11
        assert a['summary']['qa']['total']==263
        cases=[i for i in a['actual_risks'] if i['kind']=='testops_failed']
        assert len(cases)==2
        assert len({i['id'] for i in cases})==2
        assert all(i['severity']!='blocker' for i in cases)
        assert release_qa_results(r.id,run_id=None,result_status='failed',active_only=False,page=1,page_size=25,user=u,db=db)['total']==4


def test_freshness_retains_data_and_partial_coverage():
    now=datetime.utcnow()
    assert freshness(now-timedelta(minutes=9))['status']=='fresh'
    assert freshness(now-timedelta(minutes=10))['status']=='stale'
    assert freshness(now,failed=True)['status']=='failed'
    assert freshness(now,failed=True)['has_data']
    assert freshness(failed=True)['status']=='error'
    assert aggregate([freshness(now),freshness()])['status']=='partial'


def test_time_reads_only_matching_release_scope():
    with _session() as db:
        u,e,r=_release(db);e.kanban_url='https://kanban.example/p/task/123';db.commit()
        key,scope,refs=kanban_scope(r)
        db.add(ScopedAnalyticsSnapshot(scope_hash=key,scope_type='release_overview',scope_json=scope,data_json={'items':[{'epic_id':e.id,'summary':{'tracked_hours':3},'tasks':[],'worklogs':[]}]},last_success_at=datetime.utcnow()))
        db.commit()
        details,source=_release_kanban_details(db,r)
        assert details[0]['summary']['tracked_hours']==3
        assert source['has_data']


def test_shared_jira_task_uses_latest_cache_even_with_epic_filter():
    from app.models import Epic, ReleaseEpicMembership
    with _session() as db:
        u,e,r=_release(db)
        second=Epic(project_id=e.project_id,title='Second',jira_url='',confluence_url='')
        db.add(second);db.flush()
        db.add(ReleaseEpicMembership(release_id=r.id,epic_id=second.id,added_by_id=u.id))
        old=_issue(db,e,status='Новое')
        newest=_issue(db,second,status='Closed')
        db.expire_all()
        result=release_tasks(r.id,q=None,epic_id=e.id,status_filter=None,priority=None,status_group_filter=None,priority_group_filter=None,sort='priority',assignee=None,issue_type=None,page=1,page_size=25,user=u,db=db)
        assert result['total']==1
        assert result['items'][0]['is_done']
        assert len(result['items'][0]['source_epics'])==2
        assert build_release_assessment(db,r)['summary']['jira']['open_blockers']==0


def test_release_detail_access_is_denied_for_other_project():
    from app.models import User, UserRole
    from app.routers.releases import release_overview
    with _session() as db:
        u,e,r=_release(db)
        outsider=User(username='outsider',password_hash='x',role=UserRole.EMPLOYEE,is_approved=True)
        db.add(outsider);db.commit()
        with pytest.raises(HTTPException) as err:
            release_overview(r.id,target_status=None,user=outsider,db=db)
        assert err.value.status_code in (403,404)


def test_source_coverage_includes_unconfigured_epics():
    assert aggregate([freshness(datetime.utcnow()),freshness(configured=False)])['status']=='partial'
    assert aggregate([freshness(datetime.utcnow()),freshness(configured=False)])['total']==2
