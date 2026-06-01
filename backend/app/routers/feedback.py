from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import FeedbackRequest, FeedbackStatus, FeedbackType, User
from ..schemas import FeedbackAdminUpdate, FeedbackCreate, FeedbackPaginationResponse, FeedbackRead


router = APIRouter(prefix="/feedback", tags=["feedback"])


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


@router.get("/mine", response_model=FeedbackPaginationResponse)
def list_my_feedback(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackPaginationResponse:
    stmt = (
        select(FeedbackRequest)
        .where(FeedbackRequest.author_id == user.id)
        .order_by(FeedbackRequest.updated_at.desc(), FeedbackRequest.created_at.desc())
    )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all())
    return FeedbackPaginationResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=FeedbackRead, status_code=status.HTTP_201_CREATED)
def create_feedback(
    payload: FeedbackCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackRequest:
    feedback = FeedbackRequest(
        author_id=user.id,
        author_username=user.username,
        type=payload.type,
        status=FeedbackStatus.NEW,
        title=payload.title.strip(),
        description=payload.description.strip(),
        context_url=_normalize_optional_text(payload.context_url),
        expected_result=_normalize_optional_text(payload.expected_result),
        steps_to_reproduce=_normalize_optional_text(payload.steps_to_reproduce),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


@router.get("/admin", response_model=FeedbackPaginationResponse)
def list_feedback_for_admin(
    status_filter: FeedbackStatus | None = Query(default=None, alias="status"),
    type_filter: FeedbackType | None = Query(default=None, alias="type"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> FeedbackPaginationResponse:
    stmt = select(FeedbackRequest).order_by(FeedbackRequest.updated_at.desc(), FeedbackRequest.created_at.desc())

    if status_filter is not None:
        stmt = stmt.where(FeedbackRequest.status == status_filter)
    if type_filter is not None:
        stmt = stmt.where(FeedbackRequest.type == type_filter)
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(FeedbackRequest.title).like(pattern),
                func.lower(FeedbackRequest.description).like(pattern),
                func.lower(FeedbackRequest.author_username).like(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all())
    return FeedbackPaginationResponse(items=items, total=total, page=page, page_size=page_size)


@router.put("/admin/{feedback_id}", response_model=FeedbackRead)
def update_feedback_for_admin(
    feedback_id: int,
    payload: FeedbackAdminUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> FeedbackRequest:
    feedback = db.get(FeedbackRequest, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    touched = False

    if payload.status is not None and payload.status != feedback.status:
        feedback.status = payload.status
        touched = True

    if payload.admin_response is not None:
        normalized_response = _normalize_optional_text(payload.admin_response)
        if feedback.admin_response != normalized_response:
            feedback.admin_response = normalized_response
            touched = True

    if touched:
        feedback.responder_id = admin.id
        feedback.responder_username = admin.username
        feedback.responded_at = datetime.utcnow()
        db.commit()
        db.refresh(feedback)

    return feedback
