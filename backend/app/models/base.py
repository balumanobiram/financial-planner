"""Declarative base, shared columns and column types for every table."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from sqlalchemy import DateTime, Enum, MetaData, Numeric, false, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint names, so Alembic migrations can reference/drop them reliably.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Every money column: NUMERIC(14,2) <-> Decimal. Never float.
Money = Annotated[Decimal, mapped_column(Numeric(14, 2))]


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class BaseEntity(Base):
    """Columns every table has (≈ a JPA @MappedSuperclass)."""

    __abstract__ = True
    # Fetch server-generated values (created_at/updated_at) via RETURNING after INSERT/UPDATE.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, sort_order=-1)
    # timestamptz: Postgres stores UTC; we convert to IST only for display.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), sort_order=100
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), sort_order=100
    )


class ArchivableMixin:
    """Soft delete: archived rows are hidden, never removed."""

    is_archived: Mapped[bool] = mapped_column(default=False, server_default=false(), sort_order=99)


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """Store a StrEnum as VARCHAR + CHECK constraint (easier to extend than a native PG enum)."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [m.value for m in members],
        validate_strings=True,
    )
