"""Plan page (behind login): salary and planned lines. Standalone — touches nothing else."""

import uuid

from fastapi import APIRouter, status

from app.api.deps import DbSession
from app.schemas.plan import PlanItemCreate, PlanItemUpdate, PlanRead, PlanUpdate
from app.services import plan as service

router = APIRouter(prefix="/plan", tags=["plan"])


def _read(db: DbSession) -> PlanRead:
    plan = service.get_plan(db)
    db.refresh(plan, ["items"])  # pick up added / changed / deleted lines
    return service.to_read(plan)


@router.get("")
def get_plan(db: DbSession) -> PlanRead:
    plan = _read(db)
    db.commit()  # keeps the plan row if this was the first visit
    return plan


@router.patch("")
def update_plan(body: PlanUpdate, db: DbSession) -> PlanRead:
    service.update_plan(db, body)
    db.commit()
    return _read(db)


@router.post("/items", status_code=status.HTTP_201_CREATED)
def add_item(body: PlanItemCreate, db: DbSession) -> PlanRead:
    service.add_item(db, body)
    db.commit()
    return _read(db)


@router.patch("/items/{item_id}")
def update_item(item_id: uuid.UUID, body: PlanItemUpdate, db: DbSession) -> PlanRead:
    service.update_item(db, service.get_item(db, item_id), body)
    db.commit()
    return _read(db)


@router.delete("/items/{item_id}")
def delete_item(item_id: uuid.UUID, db: DbSession) -> PlanRead:
    service.delete_item(db, service.get_item(db, item_id))
    db.commit()
    return _read(db)
