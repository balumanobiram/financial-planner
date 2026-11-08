from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseEntity, Money

if TYPE_CHECKING:
    from app.models.person import Person
    from app.models.transaction import Transaction


class ExpenseShare(BaseEntity):
    """"<person> owes me <amount> of this expense." One expense can be split between several people."""

    __tablename__ = "expense_shares"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        UniqueConstraint("transaction_id", "person_id", name="uq_expense_shares_transaction_person"),
    )

    # Deleting the expense removes its shares with it.
    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id", ondelete="RESTRICT"), index=True)
    amount: Mapped[Money]  # positive: how much this person owes
    note: Mapped[str | None] = mapped_column(String(255))

    transaction: Mapped[Transaction] = relationship(back_populates="shares")
    person: Mapped[Person] = relationship()
