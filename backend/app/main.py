from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import protected_router, public_router
from app.core.config import get_settings
from app.core.login_throttle import LoginThrottle
from app.services.errors import ConflictError, NotFoundError


def create_app() -> FastAPI:
    # Load settings eagerly so a missing env var fails at startup, not on first request.
    settings = get_settings()

    app = FastAPI(title="Financial Planner API", version="0.1.0")
    app.state.login_throttle = LoginThrottle()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Domain errors → HTTP (≈ a Spring @ControllerAdvice)
    @app.exception_handler(NotFoundError)
    def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    def _conflict(_: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc)})

    app.include_router(public_router)
    app.include_router(protected_router)
    return app


app = create_app()
