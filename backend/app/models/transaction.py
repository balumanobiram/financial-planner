"""Transactions: money moving in or out of a bank account, or on a credit card.

Sign convention (the single source of truth for every balance):
  amount < 0  → debit  (money out of an account / spent on a card)
  amount > 0  → credit (money into an account / paid or refunded to a card)
Direction is derived from the sign, never stored separately.

Transfers and card payments are TWO rows sharing a `link_id`, written in one DB
transaction — e.g. paying a card: −X on the bank account, +X on the card.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseEntity, Money, str_enum

if TYPE_CHECKING:
    from app.models.bank_account import BankAccount
    from app.models.category import Category
    from app.models.credit_card import CreditCard
    from app.models.expense_share import ExpenseShare
    from app.models.person import Person


class TransactionKind(StrEnum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"  # between two of your bank accounts (linked pair)
    CARD_PAYMENT = "card_payment"  # paying a card bill from a bank account (linked pair)
    ADJUSTMENT = "adjustment"  # created by reconcile
    SETTLEMENT = "settlement"  # a person paying back what they owe

    @property
    def is_paired(self) -> bool:
        return self in (TransactionKind.TRANSFER, TransactionKind.CARD_PAYMENT)


class Transaction(BaseEntity):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="amount_nonzero"),
        # Every transaction comes from exactly one place: a bank account XOR a credit card.
        CheckConstraint("(account_id IS NULL) <> (card_id IS NULL)", name="exactly_one_source"),
        # A settlement is always money from a person arriving in a bank account.
        CheckConstraint(
            "kind <> 'settlement' OR (person_id IS NOT NULL AND account_id IS NOT NULL AND amount > 0)",
            name="settlement_shape",
        ),
        # Transfers and card payments are always one half of a linked pair.
        CheckConstraint("kind NOT IN ('transfer', 'card_payment') OR link_id IS NOT NULL", name="paired_has_link"),
        # Indexes for the list filters (date range, source, category, person) and pair lookups.
        Index("ix_transactions_account_id_occurred_at", "account_id", "occurred_at"),
        Index("ix_transactions_card_id_occurred_at", "card_id", "occurred_at"),
        Index("ix_transactions_person_id", "person_id"),
        Index("ix_transactions_occurred_at_id", "occurred_at", "id"),  # newest-first paging
        Index("ix_transactions_category_id", "category_id"),
        Index("ix_transactions_link_id", "link_id"),
    )

    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bank_accounts.id", ondelete="RESTRICT"))
    card_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credit_cards.id", ondelete="RESTRICT"))
    # Who the money came from (income, settlement). Shared expenses use expense_shares instead.
    person_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("people.id", ondelete="RESTRICT"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    # Both halves of a transfer / card payment share this id.
    link_id: Mapped[uuid.UUID | None]
    kind: Mapped[TransactionKind] = mapped_column(str_enum(TransactionKind, "transaction_kind"))
    amount: Mapped[Money]  # signed — see module docstring
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    description: Mapped[str | None] = mapped_column(String(255))
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(30)), default=list, server_default="{}")

    account: Mapped[BankAccount | None] = relationship(back_populates="transactions")
    card: Mapped[CreditCard | None] = relationship()
    person: Mapped[Person | None] = relationship()
    category: Mapped[Category | None] = relationship()
    shares: Mapped[list[ExpenseShare]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def direction(self) -> str:
        return "debit" if self.amount < 0 else "credit"
