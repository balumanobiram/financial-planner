from fastapi import APIRouter

from app.api.deps import DbSession, Today
from app.schemas.dashboard import DashboardSummary
from app.services import dashboard as service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(db: DbSession, today: Today) -> DashboardSummary:
    """Everything the home page shows, in one response (8 database round trips)."""
    return service.summary(db, today)
