"""Owed / settled arithmetic for a person. Pure functions — no database, easy to test.

  shared total  = everything they've been marked as owing (sum of their expense shares)
  settled total = everything they've paid back (sum of their settlement transactions)
  outstanding   = shared − settled                 ("owes you ₹X" when > 0)
  received      = money they sent that wasn't repayment (income tagged with them)

Settlements are applied to shares oldest-first, so each shared expense can show
Paid / Part paid / Open — like paying off the oldest invoice first.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

ZERO = Decimal("0.00")


class ShareStatus(StrEnum):
    PAID = "paid"
    PART_PAID = "partpaid"
    OPEN = "open"


@dataclass(frozen=True)
class PersonTotals:
    shared_total: Decimal
    settled_total: Decimal
    received_total: Decimal

    @property
    def outstanding(self) -> Decimal:
        return self.shared_total - self.settled_total


@dataclass(frozen=True)
class AllocatedShare:
    share_id: uuid.UUID
    amount: Decimal
    settled: Decimal
    status: ShareStatus

    @property
    def remaining(self) -> Decimal:
        return self.amount - self.settled


def allocate_settlements(shares_oldest_first: Sequence[tuple[uuid.UUID, Decimal]], settled_total: Decimal) -> list[AllocatedShare]:
    """Spread `settled_total` over the shares, oldest first."""
    if settled_total < 0:
        raise ValueError("settled_total cannot be negative")
    left = settled_total
    result: list[AllocatedShare] = []
    for share_id, amount in shares_oldest_first:
        if amount <= 0:
            raise ValueError("share amounts must be positive")
        applied = min(amount, left)
        left -= applied
        status = ShareStatus.PAID if applied == amount else ShareStatus.PART_PAID if applied > 0 else ShareStatus.OPEN
        result.append(AllocatedShare(share_id=share_id, amount=amount, settled=applied, status=status))
    return result


def check_settlement(outstanding: Decimal, amount: Decimal) -> None:
    """A settlement must be positive and can't exceed what's owed (extra is income, not repayment)."""
    if amount <= 0:
        raise ValueError("Settlement amount must be positive")
    if amount > outstanding:
        raise OverpaymentError(outstanding)


def check_split(total_spent: Decimal, share_amounts: Sequence[Decimal]) -> None:
    """Each share positive; together they can't exceed what was spent."""
    if total_spent <= 0:
        raise ValueError("Amount spent must be positive")
    if not share_amounts:
        raise ValueError("Add at least one person's share")
    if any(a <= 0 for a in share_amounts):
        raise ValueError("Each share must be positive")
    if sum(share_amounts, ZERO) > total_spent:
        raise ValueError(f"Shares add up to more than the ₹{total_spent} spent")


class OverpaymentError(ValueError):
    def __init__(self, outstanding: Decimal) -> None:
        self.outstanding = outstanding
        message = "Nothing is owed right now" if outstanding <= 0 else f"Only ₹{outstanding} is owed"
        super().__init__(f"{message} — record anything extra as income instead.")
