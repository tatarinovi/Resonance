from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from datetime import datetime

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import User, UserRole, UserWorkspace
from ..notification_prefs import VALID_PERSONAL_CHANNEL_MODES, ensure_personal_channel_mode, get_personal_channel_mode
from ..schemas import LoginRequest, MeResponse, RegistrationRequest, RegistrationResponse, TokenResponse
from ..security import create_access_token, hash_password, verify_password


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is waiting for admin approval")
    user.last_login_at = datetime.utcnow()
    db.commit()
    return TokenResponse(access_token=create_access_token(user.username))


@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegistrationRequest, db: Session = Depends(get_db)) -> RegistrationResponse:
    username = payload.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        role=UserRole.EMPLOYEE,
        workspace=payload.workspace.value,
        matrix_id=payload.matrix_id,
        direction=payload.direction,
        is_approved=False,
    )
    db.add(user)
    db.commit()
    return RegistrationResponse(message="Registration request created. Wait for admin approval.")


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    return MeResponse(
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
        kanban_connected=bool(user.kanban_token),
        direction=user.direction,
        project_ids=[p.id for p in user.projects],
        personal_channel_mode=get_personal_channel_mode(db, user.id),
    )


def _normalize_optional_str(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


@router.put("/me", response_model=MeResponse)
def update_me(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> MeResponse:
    new_password_raw = payload.get("new_password")
    if new_password_raw is not None:
        new_pw = str(new_password_raw).strip()
        if new_pw:
            if len(new_pw) < 6:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароль должен быть не короче 6 символов")
            cur_pw = str(payload.get("current_password") or "")
            if not cur_pw or not verify_password(cur_pw, user.password_hash):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный текущий пароль")
            user.password_hash = hash_password(new_pw)

    if "telegram_id" in payload:
        user.telegram_id = _normalize_optional_str(payload["telegram_id"])
    if "telegram_notifications" in payload:
        user.telegram_notifications = payload["telegram_notifications"]
    if "matrix_id" in payload:
        user.matrix_id = _normalize_optional_str(payload["matrix_id"])
    if "matrix_dm_enabled" in payload:
        user.matrix_dm_enabled = payload["matrix_dm_enabled"]
    if "matrix_dm_room_id" in payload:
        user.matrix_dm_room_id = payload["matrix_dm_room_id"]
    if "kanban_token" in payload:
        if user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Подключение Kanban в Resonance доступно только администраторам.",
            )
        user.kanban_token = payload["kanban_token"] or None

    if "personal_channel_mode" in payload:
        raw_mode = str(payload["personal_channel_mode"] or "").strip()
        if raw_mode not in VALID_PERSONAL_CHANNEL_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid personal_channel_mode",
            )
        ensure_personal_channel_mode(db, user.id, raw_mode)
    
    db.commit()
    
    return MeResponse(
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
        kanban_connected=bool(user.kanban_token),
        direction=user.direction,
        project_ids=[p.id for p in user.projects],
        personal_channel_mode=get_personal_channel_mode(db, user.id),
    )


@router.post("/kanban-connect", response_model=MeResponse)
def connect_kanban(
    payload: dict,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> MeResponse:
    email = str(payload.get("email") or "").strip()
    password = str(payload.get("password") or "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Kanban email and password are required.")

    settings = get_settings()
    base_url = settings.kanban_api_base_url.rstrip("/")

    try:
        with httpx.Client(timeout=settings.kanban_timeout_seconds) as client:
            response = client.post(
                f"{base_url}/auth/token",
                params={"email": email, "password": password},
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Kanban auth failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Invalid Kanban credentials.")

    data = response.json()
    token = data.get("token") or data.get("access_token") or (data.get("data") or {}).get("token")
    if not token or not isinstance(token, str):
        raise HTTPException(status_code=502, detail="Unexpected Kanban auth response.")

    user.kanban_token = token
    db.commit()

    return MeResponse(
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
        kanban_connected=True,
        direction=user.direction,
        project_ids=[p.id for p in user.projects],
        personal_channel_mode=get_personal_channel_mode(db, user.id),
    )


@router.get("/telegram-link")
async def get_telegram_link(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    import uuid
    from datetime import datetime, timedelta
    from ..models import TelegramLinkingToken
    from ..config import get_settings

    settings = get_settings()
    token_str = str(uuid.uuid4())
    expires = datetime.utcnow() + timedelta(minutes=10)

    # Clean existing tokens for this user
    from sqlalchemy import delete
    db.execute(delete(TelegramLinkingToken).where(TelegramLinkingToken.user_id == user.id))

    new_token = TelegramLinkingToken(
        token=token_str,
        user_id=user.id,
        expires_at=expires
    )
    db.add(new_token)
    db.commit()

    bot_url = f"https://t.me/{settings.telegram_bot_name}?start=link_{token_str}"
    return {"url": bot_url}
