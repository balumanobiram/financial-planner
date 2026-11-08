"""Report rules that need no database: periods, card statements, insights."""

import calendar
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.schemas.reports import CardStatement, CategoryLine, Insight, Period, StatementStatus
from app.services.billing import statement_date
from app.services.dashboard_math import last_n_months
from app.services.inr import format_inr

ZERO = Decimal("0.00")
MAX_RANGE_DAYS = 731  # two years
MAX_MONTHS = 24
FY_START_MONTH = 4  # Indian financial year: 1 April – 31 March

# Card charges that are interest or fees (we have no separate fee type, so match the bank's wording).
FEE_PATTERN = r"(interest|finance charge|late (payment )?fee|annual fee|joining fee|over ?limit|gst|penal)"
_FEE_RE = re.compile(FEE_PATTERN, re.IGNORECASE)


def is_fee(description: str | None) -> bool:
    return bool(description and _FEE_RE.search(description))


# ---- Periods ---------------------------------------------------------------------------------


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _short(d: date, with_year: bool) -> str:
    return f"{d.day} {d:%b}" + (f" {d.year}" if with_year else "")


def monthly_period(month: date, today: date) -> Period:
    """`month` is any day in the month."""
    start = month.replace(day=1)
    if start > today:
        raise ValueError("That month hasn't started yet")
    end = _month_end(start)
    prev_end = start - timedelta(days=1)
    return Period(
        kind="monthly", start=start, end=end, label=f"{start:%B %Y}",
        title="Monthly report", compare_label="last month", span_label="this month",
        previous_start=prev_end.replace(day=1), previous_end=prev_end, is_complete=end < today,
    )


def _add_months(first: date, n: int) -> date:
    index = first.year * 12 + first.month - 1 + n
    return date(index // 12, index % 12 + 1, 1)


def month_range_period(first: date, last: date, today: date) -> Period:
    """Whole months from `first`'s month to `last`'s (e.g. Apr–Sep), compared with the same number just before."""
    start, last_start = first.replace(day=1), last.replace(day=1)
    if start > last_start:
        raise ValueError("The first month must be on or before the last")
    if start > today:
        raise ValueError("That month hasn't started yet")
    n = (last_start.year - start.year) * 12 + last_start.month - start.month + 1
    if n > MAX_MONTHS:
        raise ValueError(f"Pick up to {MAX_MONTHS} months")
    end = _month_end(last_start)
    if n == 1:
        label = f"{start:%B %Y}"
    elif start.year == end.year:
        label = f"{start:%b} – {end:%b %Y}"
    else:
        label = f"{start:%b %Y} – {end:%b %Y}"
    previous_start = _add_months(start, -n)
    return Period(
        kind="months", start=start, end=end, label=label, title="Report",
        compare_label="the previous month" if n == 1 else f"the previous {n} months",
        span_label="this month" if n == 1 else f"over these {n} months",
        previous_start=previous_start, previous_end=start - timedelta(days=1), is_complete=end < today,
    )


def financial_year_of(day: date) -> int:
    """The starting year of the FY containing `day`: 10 Feb 2026 → 2025 (FY 2025–26)."""
    return day.year if day.month >= FY_START_MONTH else day.year - 1


def financial_year_period(start_year: int, today: date) -> Period:
    """FY {start_year}–{next}: 1 April to 31 March, compared with the previous FY."""
    if start_year > financial_year_of(today):
        raise ValueError("That financial year hasn't started yet")
    if start_year < 2000:
        raise ValueError("Pick a financial year from 2000 on")
    start, end = date(start_year, FY_START_MONTH, 1), date(start_year + 1, FY_START_MONTH, 1) - timedelta(days=1)
    return Period(
        kind="financial_year", start=start, end=end, label=f"FY {start_year}–{(start_year + 1) % 100:02d}",
        title="Financial year report", compare_label="last financial year", span_label="this financial year",
        previous_start=date(start_year - 1, FY_START_MONTH, 1), previous_end=start - timedelta(days=1), is_complete=end < today,
    )


def yearly_period(year: int, today: date) -> Period:
    if year > today.year:
        raise ValueError("That year hasn't started yet")
    if year < 2000:
        raise ValueError("Pick a year from 2000 on")
    start, end = date(year, 1, 1), date(year, 12, 31)
    return Period(
        kind="yearly", start=start, end=end, label=str(year),
        title="Yearly report", compare_label="last year", span_label="this year",
        previous_start=date(year - 1, 1, 1), previous_end=date(year - 1, 12, 31), is_complete=end < today,
    )


def range_period(start: date, end: date, today: date) -> Period:
    if start > end:
        raise ValueError("'from' must be on or before 'to'")
    if start > today:
        raise ValueError("The range starts in the future")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise ValueError("Pick a range of up to two years")
    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    label = f"{_short(start, start.year != end.year)} – {_short(end, True)}"
    return Period(
        kind="range", start=start, end=end, label=label,
        title="Report", compare_label="the previous period", span_label="over this period",
        previous_start=prev_end - timedelta(days=length - 1), previous_end=prev_end, is_complete=end < today,
    )


def trend_months(period: Period) -> list[date]:
    """Months for the income/expense chart: the last 6 for a month, the 12 of a year, or the range's months."""
    if period.kind == "monthly":
        return last_n_months(period.start, 6)
    first = period.start.replace(day=1)
    months = []
    m = first
    while m <= period.end:
        months.append(m)
        m = _add_months(m, 1)
    return months[-MAX_MONTHS:]


# ---- Money -------------------------------------------------------------------------------------


def percent_of(part: Decimal, whole: Decimal) -> Decimal:
    return (part / whole * 100).quantize(Decimal("0.1")) if whole else Decimal("0.0")


def savings_rate(income: Decimal, net: Decimal) -> Decimal | None:
    return percent_of(net, income) if income > 0 else None


# ---- Card statements ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CardDay:
    """One IST day of activity on a card."""

    net: Decimal  # Σ amounts (negative = spent)
    credits: Decimal  # Σ positive amounts (payments, refunds)
    fees: Decimal  # Σ interest/fee charges (positive number)


@dataclass(frozen=True)
class CardInfo:
    id: uuid.UUID
    card_name: str
    bank_name: str
    last4: str | None
    color: str
    statement_day: int
    payment_due_days: int
    credit_limit: Decimal | None


def _statement_dates(card: CardInfo, start: date, end: date) -> list[date]:
    dates, m = [], start.replace(day=1)
    while m <= end:
        d = statement_date(m.year, m.month, card.statement_day)
        if start <= d <= end:
            dates.append(d)
        m = (m + timedelta(days=32)).replace(day=1)
    return dates


def _next_statement(card: CardInfo, after: date) -> date:
    m = (after.replace(day=1) + timedelta(days=32)).replace(day=1)
    return statement_date(m.year, m.month, card.statement_day)


def statement_status(amount: Decimal, paid: Decimal, paid_by_due: Decimal, due: date, today: date) -> StatementStatus:
    """Judged at the due date: paid on time, paid late, part paid (not due yet), overdue, open."""
    if amount <= 0:
        return "nothing_due"
    if paid_by_due >= amount:
        return "paid"
    if due >= today:  # paying on the due date itself is on time
        return "paid" if paid >= amount else "partpaid" if paid > 0 else "open"
    return "paid_late" if paid >= amount else "overdue"


def card_statements(card: CardInfo, days: Mapping[date, CardDay], start: date, end: date, today: date) -> list[CardStatement]:
    """Every statement this card generated between start and end, from its daily activity."""

    def balance_through(d: date) -> Decimal:
        return -sum((v.net for k, v in days.items() if k <= d), ZERO)

    def credits_in(after: date, through: date) -> Decimal:
        return sum((v.credits for k, v in days.items() if after < k <= through), ZERO)

    rows = []
    for s in _statement_dates(card, start, end):
        prev = _statement_dates(card, s - timedelta(days=40), s - timedelta(days=1))
        due = s + timedelta(days=card.payment_due_days)
        amount = max(balance_through(s), ZERO)
        paid = credits_in(s, min(_next_statement(card, s), today))
        paid_by_due = credits_in(s, min(due, today))
        fees = sum((v.fees for k, v in days.items() if (prev[-1] if prev else date.min) < k <= s), ZERO)
        rows.append(
            CardStatement(
                card_id=card.id, card_name=card.card_name, bank_name=card.bank_name, last4=card.last4, color=card.color,
                statement_date=s, due_date=due, amount=amount, paid=paid, paid_by_due=paid_by_due,
                status=statement_status(amount, paid, paid_by_due, due, today),
                utilization_pct=percent_of(amount, card.credit_limit) if card.credit_limit else None,
                fees=fees,
            )
        )
    return rows


# ---- Insights ----------------------------------------------------------------------------------

CATEGORY_CHANGE_PCT = Decimal(25)  # flag a category moving at least this much…
CATEGORY_MIN_AMOUNT = Decimal(1000)  # …if it's at least this big (₹50 → ₹100 isn't news)
SAVINGS_TARGET = Decimal(20)
UTILIZATION_HIGH = Decimal(30)  # credit-score rule of thumb


def _inr(amount: Decimal) -> str:
    """₹ with Indian grouping, no paise, no sign — for insight sentences."""
    return format_inr(abs(amount), decimals=False)


def build_insights(
    *,
    period: Period,
    income: Decimal,
    expenses: Decimal,
    rate: Decimal | None,
    categories: list[CategoryLine],
    statements: list[CardStatement],
    pending_people: list[tuple[str, Decimal]],
    net_change: Decimal,
) -> list[Insight]:
    """Plain rules, most important first. Wording names the comparison period."""
    vs = period.compare_label
    bad: list[Insight] = []
    warn: list[Insight] = []
    good: list[Insight] = []
    info: list[Insight] = []

    overdue = [s for s in statements if s.status == "overdue"]
    late = [s for s in statements if s.status == "paid_late"]
    if overdue:
        n = len(overdue)
        bad.append(Insight(tone="bad", text=f"{n} card bill{'s are' if n > 1 else ' is'} overdue ({_inr(sum((s.amount - s.paid for s in overdue), ZERO))} unpaid)"))
    if late:
        n = len(late)
        warn.append(Insight(tone="warn", text=f"{n} card bill{'s' if n > 1 else ''} paid late"))
    fees = sum((s.fees for s in statements), ZERO)
    if fees > 0:
        bad.append(Insight(tone="bad", text=f"{_inr(fees)} paid in card interest or fees"))

    if income > 0 and expenses > income:
        bad.append(Insight(tone="bad", text=f"You spent {_inr(expenses - income)} more than you earned"))
    elif rate is not None and rate < SAVINGS_TARGET:
        warn.append(Insight(tone="warn", text=f"Savings rate {rate}% — below the {SAVINGS_TARGET}% target"))
    elif rate is not None:
        good.append(Insight(tone="good", text=f"You saved {rate}% of your income"))

    movers = sorted(
        (c for c in categories if c.change_pct is not None and abs(c.change_pct) >= CATEGORY_CHANGE_PCT
         and max(c.amount, c.previous) >= CATEGORY_MIN_AMOUNT),
        key=lambda c: -abs(c.amount - c.previous),
    )[:3]
    for c in movers:
        assert c.change_pct is not None
        if c.change_pct > 0:
            warn.append(Insight(tone="warn", text=f"{c.name} spend up {c.change_pct:.0f}% vs {vs}"))
        else:
            good.append(Insight(tone="good", text=f"{c.name} spend down {abs(c.change_pct):.0f}% vs {vs}"))

    for s in statements:
        if s.utilization_pct is not None and s.utilization_pct > UTILIZATION_HIGH:
            warn.append(Insight(tone="warn", text=f"{s.card_name} statement used {s.utilization_pct:.0f}% of its limit (aim for under {UTILIZATION_HIGH}%)"))

    if pending_people:
        total = sum((a for _, a in pending_people), ZERO)
        who = pending_people[0][0] if len(pending_people) == 1 else f"{len(pending_people)} people"
        info.append(Insight(tone="info", text=f"{_inr(total)} still owed to you by {who}"))
    if net_change != 0:
        during = period.span_label
        if net_change > 0:
            good.append(Insight(tone="good", text=f"Net position up {_inr(net_change)} {during}"))
        else:
            info.append(Insight(tone="info", text=f"Net position down {_inr(net_change)} {during}"))
    return bad + warn + good + info

