from types import SimpleNamespace

from app import epic_testops_service as service
from app.models import EpicTestRun


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class Client:
    pages = []

    def __init__(self, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def get(self, url, *, params=None, timeout=None):
        assert timeout
        if "/launch/" in url:
            return Response({"status": "running"})
        page = params["page"]
        self.pages.append(page)
        count = 250 if page == 0 else 1
        return Response({"content": [{"name": f"case-{page}-{index}", "status": "passed"} for index in range(count)]})


def test_fetch_testops_reads_every_result_page(monkeypatch):
    Client.pages = []
    monkeypatch.setattr(service, "get_connection", lambda *_args: SimpleNamespace(endpoint="https://testops.local"))
    monkeypatch.setattr(service, "decrypt_secret", lambda *_args: "token")
    monkeypatch.setattr(service.httpx, "Client", Client)
    run = EpicTestRun(epic_id=1, environment="test", status="planned", url="https://testops.local/launch/42", testops_launch_id="42")

    result = service.fetch_testops_run(object(), run, timeout_seconds=3)

    assert result["total"] == 251
    assert result["passed"] == 251
    assert Client.pages == [0, 1]


def test_result_identity_parameters_and_link_kind(monkeypatch):
    class ResultClient(Client):
        def get(self, url, *, params=None, timeout=None):
            if '/launch/' in url:
                return Response({'status':'running'})
            return Response({'content':[
                {'id':10,'name':'same','status':'failed','url':'/testresult/10','parameters':[{'name':'browser','value':'Firefox'}],'defectKey':'BUG-1','message':'failure'},
                {'id':11,'name':'same','status':'failed'},
            ]})
    monkeypatch.setattr(service,'get_connection',lambda *_:SimpleNamespace(endpoint='https://testops.local'))
    monkeypatch.setattr(service,'decrypt_secret',lambda *_:'test')
    monkeypatch.setattr(service.httpx,'Client',ResultClient)
    result=service.fetch_testops_run(object(),EpicTestRun(epic_id=1,environment='test',testops_launch_id='42'))
    first,second=result['problem_cases']
    assert (first['external_result_id'],second['external_result_id'])==('10','11')
    assert first['parameters']=={'browser':'Firefox'}
    assert first['link_kind']=='result' and first['external_url']=='https://testops.local/testresult/10'
    assert second['link_kind']=='launch' and second['external_url'].endswith('/launch/42')
    assert first['defect_key']=='BUG-1' and first['safe_comment']=='failure'
