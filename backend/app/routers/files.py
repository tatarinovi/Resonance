from __future__ import annotations

import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..config import get_settings
from ..deps import get_current_user
from ..models import User, UserRole
from ..storage import storage

router = APIRouter(prefix="/files", tags=["files"])
settings = get_settings()


ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/", "text/")
ALLOWED_MIME_EXACT = {
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/json",
    "application/xml",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ALLOWED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".mp4", ".mov", ".webm", ".avi",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".pdf",
    ".txt", ".log", ".md", ".rst", ".csv", ".tsv",
    ".json", ".xml", ".yaml", ".yml",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".7z", ".rar", ".tar", ".gz",
}


def _is_allowed(filename: str | None, mime: str | None) -> bool:
    normalized_mime = (mime or "").strip().lower()
    ext = os.path.splitext(filename or "")[1].lower()
    if normalized_mime == "image/svg+xml" or ext == ".svg":
        return False
    if mime:
        if any(normalized_mime.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES):
            return True
        if normalized_mime in ALLOWED_MIME_EXACT:
            return True
    if filename:
        if ext in ALLOWED_EXTENSIONS:
            return True
    return False


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)

    if size > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size {settings.max_upload_size_mb}MB",
        )

    if not _is_allowed(file.filename, file.content_type):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '{file.content_type or 'unknown'}' is not allowed",
        )

    content = await file.read()
    url = storage.upload_file(content, file.filename, file.content_type or "application/octet-stream")

    return {
        "url": url,
        "name": file.filename,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": size,
    }


@router.delete("/cleanup")
async def cleanup_orphaned_files(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    return {"message": "Cleanup scheduled"}
