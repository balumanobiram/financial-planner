"""Account balance and reconcile logic (≈ a Spring @Service).

Current balance = opening_balance + SUM(transactions.amount) for transactions
dated up to `as_of`. It is always computed, never stored, so it cannot drift.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import BankAccount, Transaction, TransactionKind
from app.services.errors import ArchivedAccountError

CENT = Decimal("0.01")


def ensure_money(value: Decimal) -> Decimal:
    """Reject non-finite values and anything with more than 2 decimal places."""
    if not value.is_finite():
        raise ValueError(f"Amount must be a finite number, got {value}")
    if value != value.quantize(CENT):
        raise ValueError(f"Amount must have at most 2 decimal places, got {value}")
    return value.quantize(CENT)


def reconciliation_difference(current_balance: Decimal, actual_balance: Decimal) -> Decimal:
    """Amount of the adjustment needed so our balance matches the bank's."""
    return ensure_money(actual_balance) - current_balance


def _require_aware(as_of: datetime) -> None:
    if as_of.tzinfo is None:
        raise ValueError("as_of must be timezone-aware (UTC)")


def account_balance(session: Session, account: BankAccount, as_of: datetime) -> Decimal:
    _require_aware(as_of)
    total = session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.account_id == account.id,
            Transaction.occurred_at <= as_of,
        )
    )
    return (account.opening_balance + Decimal(total)).quantize(CENT)


def account_balances(
    session: Session, accounts: Sequence[BankAccount], as_of: datetime
) -> dict[uuid.UUID, Decimal]:
    """Balances for many accounts in one query (avoids N+1 on the list page)."""
    _require_aware(as_of)
    if not accounts:
        return {}
    rows = session.execute(
        select(Transaction.account_id, func.sum(Transaction.amount))
        .where(
            Transaction.account_id.in_([a.id for a in accounts]),
            Transaction.occurred_at <= as_of,
        )
        .group_by(Transaction.account_id)
    ).all()
    sums: dict[uuid.UUID, Decimal] = {account_id: Decimal(total) for account_id, total in rows}
    return {a.id: (a.opening_balance + sums.get(a.id, Decimal(0))).quantize(CENT) for a in accounts}


def reconcile(
    session: Session, account: BankAccount, actual_balance: Decimal, now: datetime
) -> Transaction | None:
    """Create an adjustment so the balance equals `actual_balance`. None if already equal.

    Flushes but does not commit — the caller owns the transaction.
    """
    if account.is_archived:
        raise ArchivedAccountError(f"Account {account.id} is archived")
    current = account_balance(session, account, now)
    difference = reconciliation_difference(current, actual_balance)
    if difference == 0:
        return None
    adjustment = Transaction(
        account=account,
        kind=TransactionKind.ADJUSTMENT,
        amount=difference,
        occurred_at=now,
        description=f"Reconciled to {ensure_money(actual_balance)}",
    )
    session.add(adjustment)
    session.flush()
    return adjustment
