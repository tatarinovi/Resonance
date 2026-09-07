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
