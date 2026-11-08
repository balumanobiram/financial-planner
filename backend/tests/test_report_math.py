"""Report rules with no database (fast)."""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.schemas.reports import CategoryLine
from app.services.report_math import (
    CardDay,
    CardInfo,
    build_insights,
    card_statements,
    financial_year_of,
    financial_year_period,
    is_fee,
    month_range_period,
    monthly_period,
    range_period,
    savings_rate,
    statement_status,
    trend_months,
    yearly_period,
)

TODAY = date(2026, 11, 15)
D = Decimal


# ---- Periods ----------------------------------------------------------------------------------


def test_monthly_period() -> None:
    p = monthly_period(date(2026, 10, 17), TODAY)
    assert (p.start, p.end, p.label, p.previous_start, p.previous_end, p.is_complete) == (
        date(2026, 10, 1), date(2026, 10, 31), "October 2026", date(2026, 9, 1), date(2026, 9, 30), True,
    )
    assert monthly_period(date(2026, 11, 1), TODAY).is_complete is False  # still running
    assert monthly_period(date(2026, 3, 1), TODAY).previous_end == date(2026, 2, 28)


def test_yearly_and_range_periods() -> None:
    y = yearly_period(2026, TODAY)
    assert (y.label, y.previous_start, y.is_complete) == ("2026", date(2025, 1, 1), False)
    r = range_period(date(2026, 10, 1), date(2026, 10, 15), TODAY)
    assert (r.label, r.previous_start, r.previous_end) == ("1 Oct – 15 Oct 2026", date(2026, 9, 16), date(2026, 9, 30))
    assert range_period(date(2025, 12, 20), date(2026, 1, 5), TODAY).label == "20 Dec 2025 – 5 Jan 2026"


@pytest.mark.parametrize(
    ("call", "message"),
    [
        (lambda: monthly_period(date(2026, 12, 1), TODAY), "hasn't started"),
        (lambda: yearly_period(2027, TODAY), "hasn't started"),
        (lambda: range_period(date(2026, 10, 2), date(2026, 10, 1), TODAY), "on or before"),
        (lambda: range_period(date(2023, 1, 1), date(2026, 1, 1), TODAY), "two years"),
    ],
)
def test_invalid_periods(call: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        call()  # type: ignore[operator]


def test_trend_months() -> None:
    assert trend_months(monthly_period(date(2026, 2, 1), TODAY))[0] == date(2025, 9, 1)
    assert len(trend_months(yearly_period(2025, TODAY))) == 12
    assert trend_months(range_period(date(2026, 9, 20), date(2026, 11, 2), TODAY)) == [date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)]


def test_savings_rate() -> None:
    assert savings_rate(D("80000"), D("20000")) == D("25.0")
    assert savings_rate(D("0"), D("-500")) is None


# ---- Card statements --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "paid", "paid_by_due", "due", "expected"),
    [
        ("0", "0", "0", date(2026, 11, 1), "nothing_due"),
        ("5000", "5000", "5000", date(2026, 11, 1), "paid"),
        ("5000", "5000", "0", date(2026, 11, 1), "paid_late"),
        ("5000", "2000", "2000", date(2026, 11, 1), "overdue"),
        ("5000", "2000", "2000", date(2026, 11, 20), "partpaid"),  # not due yet
        ("5000", "0", "0", date(2026, 11, 15), "open"),  # due today: still on time
    ],
)
def test_statement_status(amount: str, paid: str, paid_by_due: str, due: date, expected: str) -> None:
    assert statement_status(D(amount), D(paid), D(paid_by_due), due, TODAY) == expected


CARD = CardInfo(id=uuid.uuid4(), card_name="Regalia", bank_name="HDFC", last4="4321", color="#111",
                statement_day=12, payment_due_days=20, credit_limit=D("100000"))


def day(net: str = "0", credits: str = "0", fees: str = "0") -> CardDay:
    return CardDay(D(net), D(credits), D(fees))


def test_card_statements_from_daily_activity() -> None:
    days = {
        date(2026, 9, 5): day("-3000"),
        date(2026, 9, 12): day("-1000", fees="236"),  # on the 12 Sep statement (statement day counts)
        date(2026, 9, 13): day("-500"),  # next statement
        date(2026, 10, 2): day("4000", credits="4000"),  # 12 Sep bill paid by its 2 Oct due date
        date(2026, 10, 12): day("-40000"),
        date(2026, 11, 5): day("10000", credits="10000"),  # after the 1 Nov due date
    }
    sep, octo = card_statements(CARD, days, date(2026, 9, 1), date(2026, 10, 31), TODAY)
    assert (sep.statement_date, sep.due_date, sep.amount, sep.paid_by_due, sep.status, sep.fees) == (
        date(2026, 9, 12), date(2026, 10, 2), D("4000"), D("4000"), "paid", D("236"),
    )
    # 12 Oct: 500 + 40000 = 40500 owed; only 10000 paid, and after the due date → overdue.
    assert (octo.amount, octo.paid, octo.paid_by_due, octo.status, octo.utilization_pct) == (
        D("40500"), D("10000"), D("0"), "overdue", D("40.5"),
    )


def test_statement_day_31_clamps_and_no_limit_means_no_utilization() -> None:
    card = CardInfo(id=uuid.uuid4(), card_name="X", bank_name="B", last4=None, color="#000", statement_day=31, payment_due_days=15, credit_limit=None)
    [feb] = card_statements(card, {date(2026, 2, 10): day("-100")}, date(2026, 2, 1), date(2026, 2, 28), TODAY)
    assert (feb.statement_date, feb.utilization_pct) == (date(2026, 2, 28), None)


@pytest.mark.parametrize(
    ("text", "expected"),
    [("FINANCE CHARGES", True), ("Late Payment Fee", True), ("IGST @18% on fees", True), ("Annual fee", True),
     ("Swiggy", False), ("Interesting book", True), (None, False)],  # "interest" inside a word still matches: cheap and rare
)
def test_is_fee(text: str | None, expected: bool) -> None:
    assert is_fee(text) is expected


# ---- Insights ---------------------------------------------------------------------------------


def cat(name: str, amount: str, previous: str, change: str | None) -> CategoryLine:
    return CategoryLine(category_id=None, name=name, color="#000", icon="Tag", amount=D(amount), percent=D("0"),
                        previous=D(previous), change_pct=None if change is None else D(change))


def insights(**over: object) -> list[tuple[str, str]]:
    args: dict[str, object] = {
        "period": monthly_period(date(2026, 10, 1), TODAY), "income": D("80000"), "expenses": D("50000"),
        "rate": D("37.5"), "categories": [], "statements": [], "pending_people": [], "net_change": D("0"),
    }
    args.update(over)
    return [(i.tone, i.text) for i in build_insights(**args)]  # type: ignore[arg-type]


def test_savings_insights() -> None:
    assert insights() == [("good", "You saved 37.5% of your income")]
    assert insights(rate=D("12.0"), expenses=D("70400")) == [("warn", "Savings rate 12.0% — below the 20% target")]
    assert insights(expenses=D("85000"), rate=D("-6.3")) == [("bad", "You spent ₹5,000 more than you earned")]
    assert insights(income=D("0"), rate=None) == []


def test_category_movers_need_size_and_change() -> None:
    cats = [
        cat("Food", "6600", "5000", "32.0"),
        cat("Fuel", "1500", "3000", "-50.0"),
        cat("Books", "300", "100", "200.0"),  # too small to mention
        cat("Rent", "18000", "17000", "5.9"),  # too small a change
    ]
    assert insights(categories=cats) == [  # warnings before good news
        ("warn", "Food spend up 32% vs last month"),
        ("good", "You saved 37.5% of your income"),
        ("good", "Fuel spend down 50% vs last month"),
    ]


def test_card_and_people_insights_are_ordered_by_severity() -> None:
    days = {date(2026, 10, 12): day("-40000")}
    statements = card_statements(CARD, days, date(2026, 10, 1), date(2026, 10, 31), TODAY)
    result = insights(statements=statements, pending_people=[("Ravi", D("600")), ("Priya", D("150"))], net_change=D("-1200"))
    assert result == [
        ("bad", "1 card bill is overdue (₹40,000 unpaid)"),
        ("warn", "Regalia statement used 40% of its limit (aim for under 30%)"),
        ("good", "You saved 37.5% of your income"),
        ("info", "₹750 still owed to you by 2 people"),
        ("info", "Net position down ₹1,200 this month"),
    ]


# ---- Month ranges and financial years ----------------------------------------------------------


def test_month_range_period() -> None:
    p = month_range_period(date(2026, 4, 9), date(2026, 9, 30), TODAY)
    assert (p.start, p.end, p.label, p.previous_start, p.previous_end) == (
        date(2026, 4, 1), date(2026, 9, 30), "Apr – Sep 2026", date(2025, 10, 1), date(2026, 3, 31),
    )
    assert (p.compare_label, p.span_label, p.is_complete) == ("the previous 6 months", "over these 6 months", True)
    across = month_range_period(date(2025, 11, 1), date(2026, 2, 1), TODAY)
    assert (across.label, across.end) == ("Nov 2025 – Feb 2026", date(2026, 2, 28))
    single = month_range_period(date(2026, 10, 1), date(2026, 10, 1), TODAY)
    assert (single.label, single.compare_label) == ("October 2026", "the previous month")
    assert len(trend_months(p)) == 6


def test_financial_year_period() -> None:
    p = financial_year_period(2026, TODAY)  # FY 2026–27, still running on 15 Nov 2026
    assert (p.label, p.start, p.end, p.previous_start, p.previous_end, p.is_complete) == (
        "FY 2026–27", date(2026, 4, 1), date(2027, 3, 31), date(2025, 4, 1), date(2026, 3, 31), False,
    )
    assert (p.title, p.compare_label, p.span_label) == ("Financial year report", "last financial year", "this financial year")
    assert len(trend_months(p)) == 12 and trend_months(p)[0] == date(2026, 4, 1)
    assert financial_year_period(1999 + 100, date(2100, 4, 1)).label == "FY 2099–00"  # century wrap: two digits


@pytest.mark.parametrize(
    ("day", "fy"),
    [(date(2026, 3, 31), 2025), (date(2026, 4, 1), 2026), (date(2027, 1, 15), 2026)],
)
def test_financial_year_of(day: date, fy: int) -> None:
    assert financial_year_of(day) == fy


@pytest.mark.parametrize(
    ("call", "message"),
    [
        (lambda: month_range_period(date(2026, 9, 1), date(2026, 4, 1), TODAY), "on or before"),
        (lambda: month_range_period(date(2026, 12, 1), date(2026, 12, 1), TODAY), "hasn't started"),
        (lambda: month_range_period(date(2024, 1, 1), date(2026, 1, 1), TODAY), "up to 24 months"),
        (lambda: financial_year_period(2027, TODAY), "hasn't started"),
    ],
)
def test_invalid_new_periods(call: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        call()  # type: ignore[operator]
