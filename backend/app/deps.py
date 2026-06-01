from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db
from .models import User, UserRole
from .security import decode_access_token
from .access_policy import is_coordinator_role


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    username = decode_access_token(token)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is waiting for admin approval")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_coordinator_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN and not is_coordinator_role(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coordinator or Admin access required")
    return user


require_manager_or_admin = require_coordinator_or_admin


def get_current_user_from_token(token: str | None) -> User | None:
    """Validate a JWT outside the Depends() machinery (used by SSE endpoint).

    Opens its own short-lived session because the caller is expected to keep
    the connection open via a streaming response, and we don't want to hold a
    session reference for the lifetime of the stream.
    """
    if not token:
        return None
    username = decode_access_token(token)
    if not username:
        return None
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user or not user.is_approved:
            return None
        db.expunge(user)
        return user
