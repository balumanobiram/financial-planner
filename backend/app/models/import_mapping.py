from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseEntity


class ImportMapping(BaseEntity):
    """How to read one bank account's or card's statement file: which column is the date,
    description, amount… Saved on import, offered next time. Never holds the file itself."""

    __tablename__ = "import_mappings"
    __table_args__ = (CheckConstraint("(account_id IS NULL) <> (card_id IS NULL)", name="exactly_one_source"),)

    # unique=True: at most one saved mapping per account / per card. Deleting the source removes it.
    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"), unique=True)
    card_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"), unique=True)
    # The validated ColumnMapping (app/schemas/imports.py) as JSON — its shape can evolve without a migration.
    mapping: Mapped[dict[str, Any]] = mapped_column(JSONB)
