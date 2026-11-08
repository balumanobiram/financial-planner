"""Dashboard rules that need no database: % change, card-due status, week/month windows."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

ZERO = Decimal("0.00")
DUE_SOON_DAYS = 5  # same as the Cards page (frontend cardForm.DUE_SOON_DAYS)
HERO_WINDOW_DAYS = 7  # the hero card shows a bill only if it's due this soon (or overdue)

DueStatus = Literal["overdue", "duesoon", "partpaid", "paid", "open"]


def pct_change(now: Decimal, previous: Decimal) -> Decimal | None:
    """% change vs `previous`, 1 decimal place. None when previous is 0 (no meaningful %)."""
    if previous == 0:
        return None
    return ((now - previous) / abs(previous) * 100).quantize(Decimal("0.1"))


@dataclass(frozen=True)
class CardDueState:
    status: DueStatus
    amount: Decimal  # what to pay now (remaining on the statement), or the running balance if the statement is paid
    remaining: Decimal  # left to pay on the last statement (≥ 0)
    due_date: date
    days_left: int  # negative = overdue


def card_due_state(
    *,
    statement_balance: Decimal,  # what you owed when the last statement was generated
    paid_since_statement: Decimal,  # payments / refunds credited since then
    outstanding: Decimal,  # what you owe right now
    last_due: date,
    next_due: date,
    today: date,
) -> CardDueState:
    remaining = max(statement_balance - paid_since_statement, ZERO) if statement_balance > 0 else ZERO
    if remaining == 0:
        # This statement is settled — show the next one (with whatever you've spent since).
        days = (next_due - today).days
        status: DueStatus = "paid" if statement_balance > 0 else "open"
        return CardDueState(status, max(outstanding, ZERO), ZERO, next_due, days)

    days = (last_due - today).days
    if days < 0:
        status = "overdue"
    elif paid_since_statement > 0:
        status = "partpaid"
    elif days <= DUE_SOON_DAYS:
        status = "duesoon"
    else:
        status = "open"
    return CardDueState(status, remaining, remaining, last_due, days)


_URGENCY = {"overdue": 0, "duesoon": 1, "partpaid": 2, "open": 3, "paid": 4}


def due_sort_key(state: CardDueState) -> tuple[int, int]:
    """Overdue first, then the nearest due date."""
    return (_URGENCY[state.status], state.days_left)


def is_hero(state: CardDueState) -> bool:
    return state.remaining > 0 and state.days_left <= HERO_WINDOW_DAYS


def week_start(today: date) -> date:
    """Monday of today's week."""
    return today - timedelta(days=today.weekday())


def month_start(today: date) -> date:
    return today.replace(day=1)


def last_n_months(today: date, n: int = 12) -> list[date]:
    """First day of each of the last n months, oldest first, ending with this month."""
    index = today.year * 12 + today.month - 1
    return [date((i // 12), i % 12 + 1, 1) for i in range(index - n + 1, index + 1)]
