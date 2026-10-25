"""Minimal transaction model — just enough for balances and reconcile. Fully built in Task 6."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseEntity, Money, str_enum

if TYPE_CHECKING:
    from app.models.bank_account import BankAccount


class TransactionKind(StrEnum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"  # created by reconcile


class Transaction(BaseEntity):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="amount_nonzero"),
        # Serves the balance query: WHERE account_id = ? AND occurred_at <= ?
        Index("ix_transactions_account_id_occurred_at", "account_id", "occurred_at"),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_accounts.id", ondelete="RESTRICT"))
    kind: Mapped[TransactionKind] = mapped_column(str_enum(TransactionKind, "transaction_kind"))
    # Signed: positive = money in, negative = money out. Balance = opening + SUM(amount).
    amount: Mapped[Money]
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    description: Mapped[str | None] = mapped_column(String(255))

    account: Mapped[BankAccount] = relationship(back_populates="transactions")
