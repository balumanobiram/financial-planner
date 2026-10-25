"""Categories. Seeded (system) and in-use categories can only be archived, never deleted."""

import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.models import Category, Transaction
from app.schemas.categories import CategoryCreate, CategoryUpdate
from app.services.errors import ArchivedError, ConflictError, NotFoundError


def list_categories(session: Session, *, include_archived: bool = False) -> list[Category]:
    stmt = select(Category).order_by(Category.sort_order, func.lower(Category.name))
    if not include_archived:
        stmt = stmt.where(Category.is_archived.is_(False))
    return list(session.scalars(stmt))


def get_category(session: Session, category_id: uuid.UUID) -> Category:
    category = session.get(Category, category_id)
    if category is None:
        raise NotFoundError(f"Category {category_id} not found")
    return category


def usable_category(session: Session, category_id: uuid.UUID) -> Category:
    """A category you can assign to a transaction right now."""
    category = get_category(session, category_id)
    if category.is_archived:
        raise ArchivedError(f"{category.name} is archived")
    return category


def _ensure_unique_name(session: Session, name: str, *, exclude_id: uuid.UUID | None = None) -> None:
    stmt = select(Category.id).where(func.lower(Category.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise ConflictError(f'A category called "{name}" already exists')


def create_category(session: Session, data: CategoryCreate) -> Category:
    _ensure_unique_name(session, data.name)
    category = Category(**data.model_dump(), is_system=False, sort_order=1000)  # custom ones after the defaults
    session.add(category)
    session.flush()
    return category


def update_category(session: Session, category: Category, data: CategoryUpdate) -> Category:
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        _ensure_unique_name(session, changes["name"], exclude_id=category.id)
    for field, value in changes.items():
        setattr(category, field, value)
    session.flush()
    return category


def set_archived(session: Session, category: Category, *, archived: bool) -> Category:
    category.is_archived = archived
    session.flush()
    return category


def delete_category(session: Session, category: Category) -> None:
    if category.is_system:
        raise ConflictError(f"{category.name} is a default category — archive it instead")
    if session.scalar(select(exists().where(Transaction.category_id == category.id))):
        raise ConflictError(f"{category.name} is used by transactions — archive it instead")
    session.delete(category)
    session.flush()
