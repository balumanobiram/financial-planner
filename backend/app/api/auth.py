from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import CurrentUser, Now, SettingsDep
from app.core.login_throttle import LoginThrottle
from app.core.security import authenticate, create_access_token
from app.schemas.auth import LoginRequest, MeResponse, TokenResponse

public_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(prefix="/auth", tags=["auth"])


@public_router.post("/login")
def login(body: LoginRequest, request: Request, settings: SettingsDep, now: Now) -> TokenResponse:
    throttle: LoginThrottle = request.app.state.login_throttle
    client_key = request.client.host if request.client else "unknown"

    if throttle.is_locked(client_key, now):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.")

    if not authenticate(
        body.username,
        body.password,
        expected_username=settings.app_username,
        password_hash=settings.app_password_hash.get_secret_value(),
    ):
        throttle.record_failure(client_key, now)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")

    throttle.reset(client_key)
    token, expires_at = create_access_token(
        settings.app_username,
        now=now,
        secret=settings.jwt_secret.get_secret_value(),
        expire_days=settings.jwt_expire_days,
    )
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.get("/me")
def me(username: CurrentUser) -> MeResponse:
    """Cheap check the frontend can call to see if its stored token is still valid."""
    return MeResponse(username=username)
