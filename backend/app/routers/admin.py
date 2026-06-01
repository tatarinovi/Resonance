from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload, attributes

from ..database import get_db
from ..access_policy import is_coordinator_role
from ..deps import require_admin, require_coordinator_or_admin
from ..directions import normalize_direction
from ..models import AppSetting, Project, User, UserWorkspace
from ..realtime import publish_event
from ..schemas import GlobalSettingsUpdate, ProjectCreate, ProjectRead, ProjectUpdate, UserCreate, UserPaginationResponse, UserRead, UserUpdate
from ..security import hash_password


router = APIRouter(prefix="/admin", tags=["admin"])


def _stored_user_direction(value: str | None) -> str | None:
    normalized = normalize_direction(value)
    return normalized.strip() if isinstance(normalized, str) and normalized.strip() else None


def _project_users(db: Session, user_ids: list[int]) -> list[User]:
    if not user_ids:
        return []
    return list(db.scalars(select(User).where(User.id.in_(user_ids))).all())


def _user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        role=user.role,
        workspace=user.workspace or UserWorkspace.DS.value,
        telegram_id=user.telegram_id,
        telegram_notifications=user.telegram_notifications,
        is_approved=user.is_approved,
        matrix_id=user.matrix_id,
        matrix_dm_enabled=user.matrix_dm_enabled,
        matrix_dm_room_id=user.matrix_dm_room_id,
        direction=user.direction,
        project_ids=[project.id for project in user.projects],
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.get("/users", response_model=UserPaginationResponse)
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None),
    role: str | None = Query(default=None),
) -> UserPaginationResponse:
    stmt = select(User).options(selectinload(User.projects)).order_by(User.id)

    if role and role != "all":
        stmt = stmt.where(User.role == role)
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.username).like(pattern),
                func.lower(User.matrix_id).like(pattern),
                func.lower(User.direction).like(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).unique().all())
    return UserPaginationResponse(
        items=[_user_read(user) for user in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> UserRead:
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=400, detail="Username already exists")
    projects = list(db.scalars(select(Project).where(Project.id.in_(payload.project_ids))).all()) if payload.project_ids else []
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        workspace=payload.workspace.value,
        telegram_id=payload.telegram_id,
        telegram_notifications=payload.telegram_notifications,
        is_approved=payload.is_approved,
        matrix_id=payload.matrix_id,
        matrix_dm_enabled=payload.matrix_dm_enabled,
        matrix_dm_room_id=payload.matrix_dm_room_id,
        direction=_stored_user_direction(payload.direction),
        projects=projects,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_read(user)


@router.put("/users/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> UserRead:
    user = db.scalar(select(User).options(selectinload(User.projects)).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.username is not None:
        user.username = payload.username
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.workspace is not None:
        user.workspace = payload.workspace.value
    if payload.telegram_id is not None:
        user.telegram_id = payload.telegram_id
    if payload.telegram_notifications is not None:
        user.telegram_notifications = payload.telegram_notifications
    if payload.is_approved is not None:
        user.is_approved = payload.is_approved
    if payload.matrix_id is not None:
        user.matrix_id = payload.matrix_id
    if payload.matrix_dm_enabled is not None:
        user.matrix_dm_enabled = payload.matrix_dm_enabled
    if payload.matrix_dm_room_id is not None:
        user.matrix_dm_room_id = payload.matrix_dm_room_id
    if payload.direction is not None:
        user.direction = _stored_user_direction(payload.direction)
    if payload.project_ids is not None:
        user.projects = list(db.scalars(select(Project).where(Project.id.in_(payload.project_ids))).all())

    db.commit()
    db.refresh(user)
    return _user_read(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


@router.get("/projects", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db), user: User = Depends(require_coordinator_or_admin)) -> list[Project]:
    if user.role == "admin":
        return list(db.scalars(select(Project).order_by(Project.id)).all())
    return user.projects


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> Project:
    config_data = jsonable_encoder(payload.config_json)
    project = Project(
        name=payload.name, 
        config_json=config_data
    )
    project.users = _project_users(db, config_data.get("user_ids", []))
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.put("/projects/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int, 
    payload: ProjectUpdate, 
    db: Session = Depends(get_db), 
    user: User = Depends(require_coordinator_or_admin)
) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # Ownership check for coordinators
    if user.role != "admin" and is_coordinator_role(user) and project_id not in [p.id for p in user.projects]:
        raise HTTPException(status_code=403, detail="You can only edit projects you are assigned to")

    if payload.name is not None:
        project.name = payload.name
    if payload.config_json is not None:
        config_data = jsonable_encoder(payload.config_json)
        print(f"DEBUG: Updating project {project_id} config with: {config_data}")
        project.config_json = config_data
        project.users = _project_users(db, config_data.get("user_ids", []))
        attributes.flag_modified(project, "config_json")
    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> None:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    publish_event([], "project.deleted", {"project_id": project_id})
    db.delete(project)
    db.commit()


@router.get("/settings/global-routing")
def get_global_routing(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> dict:
    setting = db.get(AppSetting, "global_routing")
    if not setting or not isinstance(setting.value_json, dict):
        return {"expert_room_ids": {}, "lead_matrix_ids": {}}
    raw = dict(setting.value_json)
    raw.pop("qa_user_ids", None)
    return {
        "expert_room_ids": raw.get("expert_room_ids") or {},
        "lead_matrix_ids": raw.get("lead_matrix_ids") or {},
    }


@router.put("/settings/global-routing")
def update_global_routing(payload: GlobalSettingsUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> dict:
    setting = db.get(AppSetting, "global_routing")
    if not setting:
        setting = AppSetting(key="global_routing", value_json={})
        db.add(setting)
    setting.value_json = {
        "expert_room_ids": payload.expert_room_ids,
        "lead_matrix_ids": payload.lead_matrix_ids,
    }
    db.commit()
    db.refresh(setting)
    return setting.value_json
