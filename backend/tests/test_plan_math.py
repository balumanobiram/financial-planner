"""Plan page figures (pure — no database)."""

import uuid
from decimal import Decimal

from app.models import PlanGroup
from app.services.plan_math import Line, figures, percent


def line(name: str, amount: str, group: PlanGroup) -> Line:
    return Line(uuid.uuid4(), name, Decimal(amount), group)


LINES = [
    line("Rent", "18000", PlanGroup.NEEDS),
    line("Groceries", "7000", PlanGroup.NEEDS),
    line("Eating out", "6000", PlanGroup.WANTS),
    line("Emergency fund", "5000", PlanGroup.SAVINGS),
    line("Index fund SIP", "10000", PlanGroup.INVESTMENTS),
]


def test_totals_left_over_and_percentages() -> None:
    f = figures(Decimal("80000"), LINES)
    assert (f.planned, f.left_over, f.left_over_percent) == (Decimal("46000"), Decimal("34000"), Decimal("42.5"))
    assert [(g.group.value, g.amount, g.percent_of_salary, g.items) for g in f.groups] == [
        ("needs", Decimal("25000"), Decimal("31.3"), 2),
        ("wants", Decimal("6000"), Decimal("7.5"), 1),
        ("savings", Decimal("5000"), Decimal("6.3"), 1),
        ("investments", Decimal("10000"), Decimal("12.5"), 1),
    ]
    assert f.saving_rate == Decimal("18.8")
    assert [i.name for i in f.top_items] == ["Rent", "Index fund SIP", "Groceries", "Eating out", "Emergency fund"]


def test_50_30_20_check() -> None:
    checks = {c.label: (c.actual, c.ok) for c in figures(Decimal("80000"), LINES).rule_50_30_20}
    assert checks == {
        "Needs": (Decimal("31.3"), True),
        "Wants": (Decimal("7.5"), True),
        "Savings + investments": (Decimal("18.8"), False),  # below 20%
    }


def test_planned_more_than_salary_goes_negative() -> None:
    f = figures(Decimal("40000"), LINES)
    assert f.left_over == Decimal("-6000")
    assert f.left_over_percent == Decimal("-15.0")


def test_no_salary_yet() -> None:
    f = figures(Decimal("0"), LINES)
    assert f.left_over == Decimal("-46000")
    assert f.left_over_percent is None and f.saving_rate is None
    assert all(c.ok is None for c in f.rule_50_30_20)


def test_empty_plan() -> None:
    f = figures(Decimal("50000"), [])
    assert (f.planned, f.left_over, f.top_items) == (Decimal("0.00"), Decimal("50000"), [])


def test_percent_rounds_half_up() -> None:
    assert percent(Decimal("1"), Decimal("8")) == Decimal("12.5")
    assert percent(Decimal("1"), Decimal("3")) == Decimal("33.3")
    assert percent(Decimal("1"), Decimal("0")) is None
