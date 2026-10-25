"""Shared FastAPI dependencies (≈ beans injected into controllers).

Use them as type hints in route signatures: `def route(db: DbSession, now: Now): ...`
"""

from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.security import decode_access_token


def get_now() -> datetime:
    """Current time in UTC (≈ an injectable Clock; tests can override it)."""
    return datetime.now(UTC)


Now = Annotated[datetime, Depends(get_now)]
DbSession = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_bearer = HTTPBearer(auto_error=False)


def require_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: SettingsDep,
) -> str:
    """Reject the request with 401 unless it carries a valid, unexpired Bearer token."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        subject = decode_access_token(credentials.credentials, secret=settings.jwt_secret.get_secret_value())
    except jwt.InvalidTokenError:
        raise unauthorized from None
    if subject != settings.app_username:
        raise unauthorized
    return subject


CurrentUser = Annotated[str, Depends(require_user)]
