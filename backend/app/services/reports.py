"""Builds ReportData for a month / custom range / year, plus monthly snapshots.

Like the dashboard, every section is one aggregate query (≈ 8 round trips in total);
rows are summed in Postgres, not Python. Periods are IST calendar days: a period
[start, end] covers occurred_at in [midnight IST on start, midnight IST after end).
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload

from app.core.time import IST, start_of_day_ist
from app.models import (
    BankAccount,
    Category,
    CreditCard,
    ExpenseShare,
    MonthlySnapshot,
    Person,
    Transaction,
    TransactionKind,
)
from app.schemas.reports import (
    REPORT_SCHEMA_VERSION,
    AccountLine,
    CardStatement,
    CategoryLine,
    IncomeSource,
    LargeExpense,
    NetPosition,
    Period,
    PersonLine,
    ReportData,
    Summary,
    TrendPoint,
)
from app.services import report_math as rm
from app.services.dashboard_math import pct_change
from app.services.sql_helpers import ist_day, ist_month, money, my_share_of_spend, sum_where

ZERO = Decimal("0.00")
TOP_EXPENSES = 10


def _start(d: date) -> datetime:
    return start_of_day_ist(d)


def _after(d: date) -> datetime:
    """Midnight IST at the end of day d (exclusive upper bound)."""
    return start_of_day_ist(date.fromordinal(d.toordinal() + 1))


# ---- Sections ----------------------------------------------------------------------------------


def _accounts(session: Session, p: Period) -> list[AccountLine]:
    """Opening (at the start) and closing (at the end) balance of every account that existed."""
    sums = (
        select(
            Transaction.account_id.label("aid"),
            sum_where(Transaction.amount, Transaction.occurred_at < _start(p.start)).label("before"),
            sum_where(Transaction.amount, Transaction.occurred_at < _after(p.end)).label("through"),
        )
        .where(Transaction.account_id.is_not(None))
        .group_by(Transaction.account_id)
        .subquery()
    )
    rows = session.execute(
        select(BankAccount, func.coalesce(sums.c.before, 0), func.coalesce(sums.c.through, 0))
        .outerjoin(sums, sums.c.aid == BankAccount.id)
        .where(BankAccount.opening_date <= p.end)
        .order_by(BankAccount.is_archived, BankAccount.bank_name, BankAccount.nickname)
    ).all()
    lines = []
    for account, before, through in rows:
        opening = (account.opening_balance if account.opening_date < p.start else ZERO) + money(before)
        closing = account.opening_balance + money(through)
        if account.is_archived and opening == 0 and closing == 0:
            continue  # closed long ago: nothing to say
        lines.append(AccountLine(account_id=account.id, name=account.nickname, bank_name=account.bank_name, opening=opening,
                                 closing=closing, change=closing - opening, is_archived=account.is_archived))
    return lines


def _income(session: Session, p: Period) -> list[IncomeSource]:
    rows = session.execute(
        select(func.lower(Category.name), Transaction.person_id.is_not(None), func.sum(Transaction.amount))
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.kind == TransactionKind.INCOME, Transaction.occurred_at >= _start(p.start), Transaction.occurred_at < _after(p.end))
        .group_by(func.lower(Category.name), Transaction.person_id.is_not(None))
    ).all()
    totals = {"salary": ZERO, "people": ZERO, "other": ZERO}
    for category, from_person, amount in rows:
        key = "salary" if category == "salary" else "people" if from_person or category == "family" else "other"
        totals[key] += money(amount)
    total = sum(totals.values(), ZERO)
    labels = {"salary": "Salary", "people": "Family & people", "other": "Other income"}
    return [
        IncomeSource(source=k, label=labels[k], amount=v, percent=rm.percent_of(v, total))  # type: ignore[arg-type]
        for k, v in sorted(totals.items(), key=lambda kv: -kv[1])
        if v != 0
    ]


def _categories(session: Session, p: Period) -> list[CategoryLine]:
    shares, my_spend = my_share_of_spend()
    now = (Transaction.occurred_at >= _start(p.start), Transaction.occurred_at < _after(p.end))
    before = (Transaction.occurred_at >= _start(p.previous_start), Transaction.occurred_at < _after(p.previous_end))
    rows = session.execute(
        select(Transaction.category_id, Category.name, Category.color, Category.icon, sum_where(my_spend, *now), sum_where(my_spend, *before))
        .select_from(Transaction)
        .outerjoin(shares, shares.c.tid == Transaction.id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.kind == TransactionKind.EXPENSE, Transaction.occurred_at >= _start(p.previous_start), Transaction.occurred_at < _after(p.end))
        .group_by(Transaction.category_id, Category.name, Category.color, Category.icon)
    ).all()
    total = sum((money(r[4]) for r in rows if money(r[4]) > 0), ZERO)
    lines = [
        CategoryLine(
            category_id=cid, name=name or "Uncategorised", color=color or "#94a3b8", icon=icon or "Tag",
            amount=money(cur), percent=rm.percent_of(money(cur), total), previous=money(prev),
            change_pct=pct_change(money(cur), money(prev)),
        )
        for cid, name, color, icon, cur, prev in rows
        if money(cur) > 0 or money(prev) > 0
    ]
    return sorted(lines, key=lambda c: (-c.amount, -c.previous))


def _top_expenses(session: Session, p: Period) -> list[LargeExpense]:
    rows = session.scalars(
        select(Transaction)
        .where(Transaction.kind == TransactionKind.EXPENSE, Transaction.amount < 0,
               Transaction.occurred_at >= _start(p.start), Transaction.occurred_at < _after(p.end))
        .order_by(Transaction.amount, Transaction.occurred_at)
        .limit(TOP_EXPENSES)
        .options(joinedload(Transaction.account), joinedload(Transaction.card), joinedload(Transaction.category))
    ).unique()
    return [
        LargeExpense(
            transaction_id=t.id,
            occurred_on=t.occurred_at.astimezone(IST).date(),
            description=t.description,
            category=t.category.name if t.category else None,
            source=t.account.nickname if t.account else t.card.card_name if t.card else "?",
            amount=-t.amount,
        )
        for t in rows
    ]


def _cards(session: Session, p: Period, today: date) -> tuple[list[CardStatement], Decimal, Decimal]:
    """(statements in the period, card outstanding at the end, … at the previous period's end)."""
    cards = list(session.scalars(select(CreditCard).order_by(CreditCard.is_archived, CreditCard.card_name)))
    if not cards:
        return [], ZERO, ZERO
    day = ist_day(Transaction.occurred_at)
    rows = session.execute(
        select(
            Transaction.card_id, day,
            func.sum(Transaction.amount),
            sum_where(Transaction.amount, Transaction.amount > 0),
            sum_where(-Transaction.amount, Transaction.amount < 0, Transaction.description.regexp_match(rm.FEE_PATTERN, flags="i")),
        )
        .where(Transaction.card_id.is_not(None))
        .group_by(Transaction.card_id, day)
    ).all()
    by_card: dict[Any, dict[date, rm.CardDay]] = {}
    for cid, d, net, credits, fees in rows:
        by_card.setdefault(cid, {})[d] = rm.CardDay(money(net), money(credits), money(fees))

    statements: list[CardStatement] = []
    out_end = out_prev = ZERO
    for c in cards:
        days = by_card.get(c.id, {})
        out_end -= sum((v.net for k, v in days.items() if k <= p.end), ZERO)
        out_prev -= sum((v.net for k, v in days.items() if k <= p.previous_end), ZERO)
        info = rm.CardInfo(id=c.id, card_name=c.card_name, bank_name=c.bank_name, last4=c.last4, color=c.color,
                           statement_day=c.statement_day, payment_due_days=c.payment_due_days, credit_limit=c.credit_limit)
        for s in rm.card_statements(info, days, p.start, p.end, today):
            if c.is_archived and s.status == "nothing_due":
                continue
            statements.append(s)
    statements.sort(key=lambda s: (s.statement_date, s.card_name))
    return statements, out_end, out_prev


def _people(session: Session, p: Period) -> list[PersonLine]:
    before, upto = Transaction.occurred_at < _start(p.start), Transaction.occurred_at < _after(p.end)
    shares = (
        select(ExpenseShare.person_id.label("pid"), sum_where(ExpenseShare.amount, before).label("before"),
               sum_where(ExpenseShare.amount, upto).label("upto"))
        .join(Transaction, Transaction.id == ExpenseShare.transaction_id)
        .group_by(ExpenseShare.person_id)
        .subquery()
    )
    settled = (
        select(Transaction.person_id.label("pid"), sum_where(Transaction.amount, before).label("before"),
               sum_where(Transaction.amount, upto).label("upto"))
        .where(Transaction.kind == TransactionKind.SETTLEMENT)
        .group_by(Transaction.person_id)
        .subquery()
    )
    rows = session.execute(
        select(Person.id, Person.name, shares.c.before, shares.c.upto, settled.c.before, settled.c.upto)
        .outerjoin(shares, shares.c.pid == Person.id)
        .outerjoin(settled, settled.c.pid == Person.id)
        .order_by(Person.name)
    ).all()
    lines = []
    for pid, name, sh_before, sh_upto, se_before, se_upto in rows:
        owed_start = money(sh_before) - money(se_before)
        new = money(sh_upto) - money(sh_before)
        paid = money(se_upto) - money(se_before)
        pending = owed_start + new - paid
        if owed_start or new or paid or pending:
            lines.append(PersonLine(person_id=pid, name=name, owed_at_start=owed_start, new_shares=new, settled=paid, pending=pending))
    return sorted(lines, key=lambda line: -line.pending)


def _trend(session: Session, p: Period) -> list[TrendPoint]:
    months = rm.trend_months(p)
    shares, my_spend = my_share_of_spend()
    month = ist_month(Transaction.occurred_at)
    rows = session.execute(
        select(
            month,
            sum_where(Transaction.amount, Transaction.kind == TransactionKind.INCOME),
            sum_where(my_spend, Transaction.kind == TransactionKind.EXPENSE),
        )
        .select_from(Transaction)
        .outerjoin(shares, shares.c.tid == Transaction.id)
        .where(Transaction.occurred_at >= _start(months[0]), Transaction.occurred_at < _after(p.end))
        .group_by(month)
    ).all()
    found = {m: (money(i), money(e)) for m, i, e in rows}
    return [TrendPoint(month=m, income=found.get(m, (ZERO, ZERO))[0], expenses=found.get(m, (ZERO, ZERO))[1]) for m in months]


# ---- Assembly ----------------------------------------------------------------------------------


def build_report(session: Session, period: Period, today: date, now: datetime) -> ReportData:
    accounts = _accounts(session, period)
    income_sources = _income(session, period)
    categories = _categories(session, period)
    statements, cards_end, cards_prev = _cards(session, period, today)
    people = _people(session, period)

    income = sum((s.amount for s in income_sources), ZERO)
    expenses = sum((c.amount for c in categories), ZERO)
    net = income - expenses
    rate = rm.savings_rate(income, net)
    banks_open = sum((a.opening for a in accounts), ZERO)
    banks_close = sum((a.closing for a in accounts), ZERO)
    owed_end = sum((max(x.pending, ZERO) for x in people), ZERO)
    owed_start = sum((max(x.owed_at_start, ZERO) for x in people), ZERO)
    value = banks_close + owed_end - cards_end
    previous = banks_open + owed_start - cards_prev

    return ReportData(
        period=period,
        generated_at=now,
        summary=Summary(accounts=accounts, banks_opening=banks_open, banks_closing=banks_close, income=income,
                        expenses=expenses, net_savings=net, savings_rate=rate),
        income_sources=income_sources,
        expense_categories=categories,
        top_expenses=_top_expenses(session, period),
        cards=statements,
        people=people,
        net_position=NetPosition(banks=banks_close, owed_to_me=owed_end, card_outstanding=cards_end, value=value,
                                 previous_value=previous, change=value - previous),
        trend=_trend(session, period),
        insights=rm.build_insights(
            period=period, income=income, expenses=expenses, rate=rate, categories=categories, statements=statements,
            pending_people=[(x.name, x.pending) for x in people if x.pending > 0], net_change=value - previous,
        ),
    )


def monthly_report(session: Session, month: date, today: date, now: datetime, *, regenerate: bool = False) -> ReportData:
    """A finished month comes from its snapshot (made on first view); the current month is always live."""
    period = rm.monthly_period(month, today)
    if not period.is_complete:
        return build_report(session, period, today, now)

    if not regenerate:
        snap = session.scalar(select(MonthlySnapshot).where(MonthlySnapshot.month == period.start))
        if snap is not None and snap.schema_version == REPORT_SCHEMA_VERSION:
            try:
                return ReportData.model_validate(snap.data).model_copy(update={"from_snapshot": True})
            except ValueError:
                pass  # unreadable: rebuild below

    report = build_report(session, period, today, now)
    data = report.model_dump(mode="json")
    # Upsert: one snapshot per month, replaced on Regenerate (≈ JPA merge, done in one SQL statement).
    stmt = insert(MonthlySnapshot).values(month=period.start, schema_version=REPORT_SCHEMA_VERSION, data=data)
    session.execute(
        stmt.on_conflict_do_update(
            index_elements=[MonthlySnapshot.month],
            set_={"schema_version": stmt.excluded.schema_version, "data": stmt.excluded.data, "updated_at": func.now()},
        )
    )
    return report
