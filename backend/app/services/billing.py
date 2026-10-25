"""Credit card billing-cycle dates. Pure functions — no database, easy to test.

A card generates a statement on `statement_day` every month (moved to the month's
last day when the month is shorter), and payment is due `payment_due_days` later.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class BillingCycle:
    last_statement_date: date
    last_due_date: date
    next_statement_date: date
    next_due_date: date
    pay_by: date  # the due date that matters right now
    days_until_pay_by: int


def statement_date(year: int, month: int, statement_day: int) -> date:
    """Statement date in a given month; day 29–31 clamps to the month's last day."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(statement_day, last_day))


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def billing_cycle(today: date, statement_day: int, payment_due_days: int) -> BillingCycle:
    if not 1 <= statement_day <= 31:
        raise ValueError("statement_day must be 1–31")
    if payment_due_days < 1:
        raise ValueError("payment_due_days must be at least 1")

    this_month = statement_date(today.year, today.month, statement_day)
    if this_month <= today:  # this month's statement is already out (today counts)
        last_statement = this_month
        next_statement = statement_date(*_add_months(today.year, today.month, 1), statement_day)
    else:
        last_statement = statement_date(*_add_months(today.year, today.month, -1), statement_day)
        next_statement = this_month

    days = timedelta(days=payment_due_days)
    last_due = last_statement + days
    next_due = next_statement + days
    # Until the last statement's due date passes, that's the one to pay; then the next cycle's.
    pay_by = last_due if today <= last_due else next_due

    return BillingCycle(
        last_statement_date=last_statement,
        last_due_date=last_due,
        next_statement_date=next_statement,
        next_due_date=next_due,
        pay_by=pay_by,
        days_until_pay_by=(pay_by - today).days,
    )
