from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, SmallInteger, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import ArchivableMixin, BaseEntity, str_enum


class CategoryKind(StrEnum):
    """Which transactions a category is offered for first (any category can still be used anywhere)."""

    EXPENSE = "expense"
    INCOME = "income"
    ANY = "any"


class Category(ArchivableMixin, BaseEntity):
    """Spending/income category with a lucide icon and colour. Seeded ones (is_system) can't be deleted."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("color ~ '^#[0-9a-f]{6}$'", name="color_hex"),
        # "Food" and "food" are the same category. (text(): lower() of the *column*,
        # not func.lower("name"), which would lowercase the literal string 'name'.)
        Index("uq_categories_name_lower", text("lower(name)"), unique=True),
    )

    name: Mapped[str] = mapped_column(String(50))
    icon: Mapped[str] = mapped_column(String(50))  # lucide-react component name, e.g. "UtensilsCrossed"
    color: Mapped[str] = mapped_column(String(7))
    kind: Mapped[CategoryKind] = mapped_column(str_enum(CategoryKind, "category_kind"))
    is_system: Mapped[bool] = mapped_column(default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=100, server_default="100")
