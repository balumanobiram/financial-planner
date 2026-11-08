"""SQL building blocks shared by the dashboard and reports."""

from decimal import Decimal
from typing import Any

from sqlalchemy import Date, and_, cast, func, literal_column, select

from app.models import ExpenseShare, Transaction

# Constants written into the SQL text rather than sent as parameters: Postgres requires a
# GROUP BY expression to match the SELECT one exactly, and two separate parameters
# ($1, $2) holding the same 'Asia/Kolkata' don't count as matching.
_IST = literal_column("'Asia/Kolkata'")
_MONTH = literal_column("'month'")


def ist_day(column: Any) -> Any:
    return cast(func.timezone(_IST, column), Date)


def ist_month(column: Any) -> Any:
    return cast(func.date_trunc(_MONTH, func.timezone(_IST, column)), Date)


def money(value: Any) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"))


def sum_where(column: Any, *conditions: Any) -> Any:
    """SUM(column) FILTER (WHERE …), 0 when there are no rows."""
    total = func.sum(column)
    return func.coalesce(total.filter(and_(*conditions)) if conditions else total, 0)


def my_share_of_spend() -> tuple[Any, Any]:
    """(per-transaction split totals subquery, expression for *your* part of an expense).
    A ₹1,800 dinner where friends owe ₹1,200 is ₹600 of your spending; a refund (+) reduces it."""
    shares = (
        select(ExpenseShare.transaction_id.label("tid"), func.sum(ExpenseShare.amount).label("total"))
        .group_by(ExpenseShare.transaction_id)
        .subquery()
    )
    return shares, -Transaction.amount - func.coalesce(shares.c.total, 0)
