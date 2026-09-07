"""Smoke tests for the relaxed file-upload mime/extension allow-list."""
from __future__ import annotations

from app.routers.files import _is_allowed
import pytest


def test_allows_pdf_by_mime():
    assert _is_allowed("report.pdf", "application/pdf")


def test_allows_zip_by_extension_only():
    assert _is_allowed("archive.zip", None)


def test_allows_text_by_prefix():
    assert _is_allowed("notes.txt", "text/plain")


def test_rejects_unknown_binary():
    assert not _is_allowed("malware.exe", "application/x-msdownload")
    assert not _is_allowed("malware.exe", None)


def test_allows_image():
    assert _is_allowed("photo.png", "image/png")


def test_rejects_svg_even_with_image_mime():
    assert not _is_allowed("diagram.svg", "image/svg+xml")


def test_rejects_octet_stream_without_known_extension():
    assert not _is_allowed("blob.bin", "application/octet-stream")


def test_allows_office_docx():
    assert _is_allowed(
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@pytest.mark.parametrize("filename,mime", [
    ("page.html", "text/html"),
    ("page.HTM", "text/plain"),
    ("page.xhtml", "application/octet-stream"),
    ("notes.txt", "text/html; charset=utf-8"),
    ("photo.png", "application/xhtml+xml"),
    ("photo.png", "image/svg+xml; charset=utf-8"),
])
def test_rejects_active_content_even_with_allowed_extension_or_mime(filename, mime):
    assert not _is_allowed(filename, mime)


def test_storage_marks_attachments_for_download():
    from unittest.mock import Mock
    from app.storage import S3Storage

    storage = S3Storage.__new__(S3Storage)
    storage.s3 = Mock()
    storage.bucket = "test-attachments"
    storage.upload_file(b"<html>untrusted</html>", "notes.txt", "text/plain")
    uploaded = storage.s3.put_object.call_args.kwargs
    assert uploaded["ContentDisposition"] == "attachment"
    assert uploaded["Body"] == b"<html>untrusted</html>"


def test_upload_checks_auth_and_rejects_html_before_storage(monkeypatch):
    from unittest.mock import Mock
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.deps import get_current_user
    from app.models import User
    from app.routers import files

    app = FastAPI()
    app.include_router(files.router)
    upload = Mock(return_value="https://files.example.test/notes.txt")
    monkeypatch.setattr(files.storage, "upload_file", upload)
    client = TestClient(app)

    assert client.post("/files/upload", files={"file": ("notes.txt", b"hello", "text/plain")}).status_code == 401
    upload.assert_not_called()
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="tester")

    response = client.post("/files/upload", files={"file": ("notes.txt", b"<html></html>", "text/html")})
    assert response.status_code == 415
    upload.assert_not_called()

    response = client.post("/files/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 200
    assert response.json()["size_bytes"] == 5
    upload.assert_called_once_with(b"hello", "notes.txt", "text/plain")
