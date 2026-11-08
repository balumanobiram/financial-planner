import uuid

from fastapi import APIRouter, status

from app.api.deps import DbSession
from app.schemas.categories import CategoryCreate, CategoryList, CategoryRead, CategoryUpdate
from app.services import categories as service

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories(db: DbSession, include_archived: bool = False) -> CategoryList:
    items = service.list_categories(db, include_archived=include_archived)
    return CategoryList(items=[CategoryRead.model_validate(c) for c in items])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, db: DbSession) -> CategoryRead:
    category = service.create_category(db, body)
    db.commit()
    return CategoryRead.model_validate(category)


@router.patch("/{category_id}")
def update_category(category_id: uuid.UUID, body: CategoryUpdate, db: DbSession) -> CategoryRead:
    category = service.update_category(db, service.get_category(db, category_id), body)
    db.commit()
    return CategoryRead.model_validate(category)


@router.post("/{category_id}/archive")
def archive_category(category_id: uuid.UUID, db: DbSession) -> CategoryRead:
    category = service.set_archived(db, service.get_category(db, category_id), archived=True)
    db.commit()
    return CategoryRead.model_validate(category)


@router.post("/{category_id}/unarchive")
def unarchive_category(category_id: uuid.UUID, db: DbSession) -> CategoryRead:
    category = service.set_archived(db, service.get_category(db, category_id), archived=False)
    db.commit()
    return CategoryRead.model_validate(category)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: uuid.UUID, db: DbSession) -> None:
    """Only unused custom categories can be deleted; others can be archived."""
    service.delete_category(db, service.get_category(db, category_id))
    db.commit()
