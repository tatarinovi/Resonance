"""Smoke tests for the relaxed file-upload mime/extension allow-list."""
from __future__ import annotations

from app.routers.files import _is_allowed


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


def test_allows_office_docx():
    assert _is_allowed(
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
