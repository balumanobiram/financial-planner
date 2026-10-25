from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Unauthenticated liveness check (used by Render and by you)."""
    return {"status": "ok"}
