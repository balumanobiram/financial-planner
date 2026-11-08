"""Dashboard rules with no database (fast)."""

from datetime import date
from decimal import Decimal

import pytest

from app.services.dashboard_math import (
    card_due_state,
    due_sort_key,
    is_hero,
    last_n_months,
    month_start,
    pct_change,
    week_start,
)

TODAY = date(2026, 10, 26)  # a Monday
D = Decimal


@pytest.mark.parametrize(
    ("now", "previous", "expected"),
    [
        ("110", "100", D("10.0")),
        ("90", "100", D("-10.0")),
        ("50", "-100", D("150.0")),  # from −100 to +50 is an improvement
        ("100", "0", None),
        ("1", "3", D("-66.7")),
    ],
)
def test_pct_change(now: str, previous: str, expected: Decimal | None) -> None:
    assert pct_change(D(now), D(previous)) == expected


def due(statement: str, paid: str, outstanding: str, last_due: date = date(2026, 10, 29)) -> object:
    return card_due_state(
        statement_balance=D(statement), paid_since_statement=D(paid), outstanding=D(outstanding),
        last_due=last_due, next_due=date(2026, 11, 28), today=TODAY,
    )


def test_unpaid_statement_due_soon() -> None:
    s = due("5000", "0", "6200")
    assert (s.status, s.amount, s.due_date, s.days_left) == ("duesoon", D("5000"), date(2026, 10, 29), 3)
    assert is_hero(s)


def test_part_paid() -> None:
    s = due("5000", "2000", "4200")
    assert (s.status, s.amount, s.remaining) == ("partpaid", D("3000"), D("3000"))


def test_overdue_beats_part_paid() -> None:
    s = due("5000", "2000", "4200", last_due=date(2026, 10, 20))
    assert (s.status, s.days_left) == ("overdue", -6)
    assert is_hero(s)


def test_paid_statement_moves_to_next_cycle() -> None:
    s = due("5000", "5000", "1200")
    assert (s.status, s.amount, s.remaining, s.due_date) == ("paid", D("1200"), D("0"), date(2026, 11, 28))
    assert not is_hero(s)


def test_nothing_billed_is_open() -> None:
    s = due("0", "0", "800", last_due=date(2026, 11, 20))
    assert (s.status, s.amount) == ("open", D("800"))
    assert not is_hero(s)


def test_far_away_bill_is_not_the_hero() -> None:
    s = due("5000", "0", "5000", last_due=date(2026, 11, 10))
    assert s.status == "open" and not is_hero(s)


def test_urgency_order() -> None:
    states = [due("1", "0", "1", date(2026, 11, 10)), due("1", "0", "1", date(2026, 10, 20)), due("1", "0", "1")]
    assert [s.status for s in sorted(states, key=due_sort_key)] == ["overdue", "duesoon", "open"]


def test_windows() -> None:
    assert week_start(date(2026, 11, 1)) == date(2026, 10, 26)  # Sunday → its Monday
    assert week_start(TODAY) == TODAY
    assert month_start(TODAY) == date(2026, 10, 1)
    months = last_n_months(date(2026, 2, 15))
    assert (len(months), months[0], months[-1]) == (12, date(2025, 3, 1), date(2026, 2, 1))
