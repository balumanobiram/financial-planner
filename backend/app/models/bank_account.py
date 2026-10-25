from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import ArchivableMixin, BaseEntity, Money, str_enum

if TYPE_CHECKING:
    from app.models.transaction import Transaction


class AccountType(StrEnum):
    SAVINGS = "savings"
    CURRENT = "current"
    SALARY = "salary"
    WALLET = "wallet"


class BankAccount(ArchivableMixin, BaseEntity):
    """A savings/current/salary account or wallet. Balance is computed, never stored."""

    __tablename__ = "bank_accounts"
    __table_args__ = (CheckConstraint("last4 ~ '^[0-9]{4}$'", name="last4_digits"),)

    bank_name: Mapped[str] = mapped_column(String(100))
    nickname: Mapped[str] = mapped_column(String(100))
    account_type: Mapped[AccountType] = mapped_column(str_enum(AccountType, "account_type"))
    last4: Mapped[str | None] = mapped_column(String(4))
    opening_balance: Mapped[Money] = mapped_column(default=Decimal("0.00"), server_default="0")
    opening_date: Mapped[date]
    notes: Mapped[str | None] = mapped_column(Text)

    transactions: Mapped[list[Transaction]] = relationship(back_populates="account")
