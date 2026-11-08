"""The home page's numbers, computed in Postgres with few round trips.

Neon is ~50 ms away, so the cost that matters is the number of queries, not rows:
every section below is ONE aggregate query (GROUP BY / FILTER / scalar subqueries),
and the whole summary is 8 round trips however much data you have.

Day and month boundaries are IST: timezone('Asia/Kolkata', occurred_at) turns the stored
UTC timestamp into Indian local time before taking its date or month.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Numeric, and_, case, func, literal, not_, select, union_all
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.time import start_of_day_ist
from app.models import BankAccount, Category, CreditCard, ExpenseShare, Person, Transaction, TransactionKind
from app.schemas.dashboard import (
    CardDue,
    CategorySlice,
    DaySpend,
    DashboardSummary,
    ExpenseBreakdown,
    MonthFlow,
    Stat,
    Stats,
    WeekSpending,
)
from app.schemas.transactions import TransactionItem
from app.services import transaction_queries as queries
from app.services.billing import billing_cycle
from app.services.sql_helpers import ist_day, ist_month, money, my_share_of_spend, sum_where
from app.services.dashboard_math import (
    ZERO,
    CardDueState,
    card_due_state,
    due_sort_key,
    is_hero,
    last_n_months,
    month_start,
    pct_change,
    week_start,
)

PAIRED = [TransactionKind.TRANSFER, TransactionKind.CARD_PAYMENT]
RECENT_COUNT = 8
TOP_CATEGORIES = 6  # the rest of the donut becomes "Other categories"

# ---- Round trip 2: the four stats, now and at the start of the month -------------------------


def _stats(session: Session, first_of_month: date) -> Stats:
    cut = start_of_day_ist(first_of_month)
    active_accounts = select(BankAccount.id).where(BankAccount.is_archived.is_(False))
    active_cards = select(CreditCard.id).where(CreditCard.is_archived.is_(False))
    before = Transaction.occurred_at < cut

    def txnsum_where(*conditions: Any) -> Any:
        return select(sum_where(Transaction.amount)).where(*conditions).scalar_subquery()

    def opening(*conditions: Any) -> Any:
        return select(sum_where(BankAccount.opening_balance)).where(BankAccount.is_archived.is_(False), *conditions).scalar_subquery()

    # Owed to me = Σ per active person of max(shared − settled, 0) — same as the People page.
    shares = (
        select(
            ExpenseShare.person_id.label("pid"),
            sum_where(ExpenseShare.amount).label("now"),
            sum_where(ExpenseShare.amount, before).label("prev"),
        )
        .join(Transaction, Transaction.id == ExpenseShare.transaction_id)
        .group_by(ExpenseShare.person_id)
        .subquery()
    )
    settled = (
        select(Transaction.person_id.label("pid"), sum_where(Transaction.amount).label("now"), sum_where(Transaction.amount, before).label("prev"))
        .where(Transaction.kind == TransactionKind.SETTLEMENT)
        .group_by(Transaction.person_id)
        .subquery()
    )

    def owed(col: str) -> Any:
        balance = func.coalesce(shares.c[col], 0) - func.coalesce(settled.c[col], 0)
        return (
            select(func.coalesce(func.sum(func.greatest(balance, 0)), 0))
            .select_from(Person)
            .outerjoin(shares, shares.c.pid == Person.id)
            .outerjoin(settled, settled.c.pid == Person.id)
            .where(Person.is_archived.is_(False))
            .scalar_subquery()
        )

    row = session.execute(
        select(
            opening(),
            opening(BankAccount.opening_date < first_of_month),
            txnsum_where(Transaction.account_id.in_(active_accounts)),
            txnsum_where(Transaction.account_id.in_(active_accounts), before),
            txnsum_where(Transaction.card_id.in_(active_cards)),
            txnsum_where(Transaction.card_id.in_(active_cards), before),
            owed("now"),
            owed("prev"),
        )
    ).one()
    open_now, open_prev, bank_now, bank_prev, card_now, card_prev, owed_now, owed_prev = map(money, row)

    def stat(now: Decimal, prev: Decimal) -> Stat:
        return Stat(value=now, previous=prev, change_pct=pct_change(now, prev))

    banks = stat(open_now + bank_now, open_prev + bank_prev)
    cards = stat(-card_now, -card_prev)  # card rows are negative when you spend
    people = stat(owed_now, owed_prev)
    return Stats(
        bank_total=banks,
        card_outstanding=cards,
        owed_to_me=people,
        net_position=stat(banks.value + people.value - cards.value, banks.previous + people.previous - cards.previous),
    )


# ---- Round trip 3: each card's statement balance and payments since ----------------------------


def _card_dues(session: Session, cards: list[CreditCard], today: date) -> list[tuple[CardDueState, CardDue]]:
    if not cards:
        return []
    cycles = {c.id: billing_cycle(today, c.statement_day, c.payment_due_days) for c in cards}
    # Everything up to the end of the statement day is on that statement. Each card has its own
    # cut-off, so it goes into the query as a CASE — still one query for all cards.
    cutoff = case(
        *[(Transaction.card_id == cid, literal(start_of_day_ist(cyc.last_statement_date + timedelta(days=1)), DateTime(timezone=True)))
          for cid, cyc in cycles.items()],
    )
    rows = session.execute(
        select(
            Transaction.card_id,
            sum_where(Transaction.amount),
            sum_where(Transaction.amount, Transaction.occurred_at < cutoff),
            sum_where(Transaction.amount, Transaction.occurred_at >= cutoff, Transaction.amount > 0),
        )
        .where(Transaction.card_id.in_(list(cycles)))
        .group_by(Transaction.card_id)
    ).all()
    sums = {cid: (money(total), money(at_statement), money(paid)) for cid, total, at_statement, paid in rows}

    dues: list[tuple[CardDueState, CardDue]] = []
    for card in cards:
        total, at_statement, paid = sums.get(card.id, (ZERO, ZERO, ZERO))
        cycle = cycles[card.id]
        state = card_due_state(
            statement_balance=-at_statement, paid_since_statement=paid, outstanding=-total,
            last_due=cycle.last_due_date, next_due=cycle.next_due_date, today=today,
        )
        dues.append((
            state,
            CardDue(
                card_id=card.id, card_name=card.card_name, bank_name=card.bank_name, last4=card.last4, color=card.color,
                status=state.status, amount=state.amount, statement_balance=max(-at_statement, ZERO),
                paid_since_statement=paid, outstanding=-total, due_date=state.due_date, days_left=state.days_left,
            ),
        ))
    dues.sort(key=lambda pair: due_sort_key(pair[0]))
    return dues


# ---- Round trip 4: monthly in/out + daily spending, one UNION ALL ------------------------------


def _flows(session: Session, today: date) -> tuple[list[MonthFlow], WeekSpending]:
    months = last_n_months(today)
    this_week = week_start(today)
    last_week = this_week - timedelta(days=7)
    shares, my_spend = my_share_of_spend()
    zero = literal(0, Numeric(14, 2))

    monthly = (
        select(
            literal("m").label("tag"),
            ist_month(Transaction.occurred_at).label("day"),
            sum_where(Transaction.amount, Transaction.amount > 0).label("a"),
            sum_where(-Transaction.amount, Transaction.amount < 0).label("b"),
        )
        .where(Transaction.kind.not_in(PAIRED), Transaction.occurred_at >= start_of_day_ist(months[0]))
        .group_by(ist_month(Transaction.occurred_at))
    )
    daily = (
        select(literal("d"), ist_day(Transaction.occurred_at), sum_where(my_spend), zero)
        .select_from(Transaction)
        .outerjoin(shares, shares.c.tid == Transaction.id)
        .where(Transaction.kind == TransactionKind.EXPENSE, Transaction.occurred_at >= start_of_day_ist(last_week))
        .group_by(ist_day(Transaction.occurred_at))
    )
    by_month: dict[date, tuple[Decimal, Decimal]] = {}
    by_day: dict[date, Decimal] = {}
    for tag, day, a, b in session.execute(union_all(monthly, daily)):
        if tag == "m":
            by_month[day] = (money(a), money(b))
        else:
            by_day[day] = money(a)

    flows = [MonthFlow(month=m, inflow=by_month.get(m, (ZERO, ZERO))[0], outflow=by_month.get(m, (ZERO, ZERO))[1]) for m in months]
    days = [DaySpend(day=this_week + timedelta(days=i), amount=by_day.get(this_week + timedelta(days=i), ZERO)) for i in range(7)]
    total = sum((d.amount for d in days), ZERO)
    # Fair comparison: this week so far vs the same days of last week (Mon → today's weekday).
    so_far = today.weekday() + 1
    last = sum((by_day.get(last_week + timedelta(days=i), ZERO) for i in range(so_far)), ZERO)
    return flows, WeekSpending(days=days, total=total, last_week_total=last, change_pct=pct_change(total, last))


# ---- Round trip 5: spending by category, this week and this month in one pass ------------------


def _slices(rows: list[tuple[Any, ...]], index: int) -> tuple[list[CategorySlice], Decimal]:
    items = sorted(((r, money(r[index])) for r in rows if money(r[index]) > 0), key=lambda p: -p[1])
    total = sum((amount for _, amount in items), ZERO)
    if total == 0:
        return [], ZERO

    def pct(amount: Decimal) -> Decimal:
        return (amount / total * 100).quantize(Decimal("0.1"))

    slices = [
        CategorySlice(
            category_id=r[0], name=r[1] or "Uncategorised", icon=r[2] or "Tag", color=r[3] or "#94a3b8",
            amount=amount, percent=pct(amount),
        )
        for r, amount in items[:TOP_CATEGORIES]
    ]
    rest = sum((amount for _, amount in items[TOP_CATEGORIES:]), ZERO)
    if rest > 0:
        slices.append(CategorySlice(category_id=None, name="Other categories", icon="Tag", color="#cbd5e1", amount=rest, percent=pct(rest)))
    return slices, total


def _expenses(session: Session, today: date) -> ExpenseBreakdown:
    week_from, month_from = start_of_day_ist(week_start(today)), start_of_day_ist(month_start(today))
    shares, my_spend = my_share_of_spend()
    rows = [
        tuple(r)
        for r in session.execute(
            select(
                Transaction.category_id, Category.name, Category.icon, Category.color,
                sum_where(my_spend, Transaction.occurred_at >= week_from),
                sum_where(my_spend, Transaction.occurred_at >= month_from),
            )
            .select_from(Transaction)
            .outerjoin(shares, shares.c.tid == Transaction.id)
            .outerjoin(Category, Category.id == Transaction.category_id)
            .where(Transaction.kind == TransactionKind.EXPENSE, Transaction.occurred_at >= min(week_from, month_from))
            .group_by(Transaction.category_id, Category.name, Category.icon, Category.color)
        )
    ]
    week, week_total = _slices(rows, 4)
    month, month_total = _slices(rows, 5)
    return ExpenseBreakdown(week=week, month=month, week_total=week_total, month_total=month_total)


# ---- Round trips 6–8: recent transactions (rows, their splits, the other side of pairs) ---------


def _recent(session: Session) -> list[TransactionItem]:
    rows = list(
        session.scalars(
            select(Transaction)
            # A transfer is two rows; show only the money-out half (like the Transactions page).
            .where(not_(and_(Transaction.kind.in_(PAIRED), Transaction.amount > 0)))
            .order_by(Transaction.occurred_at.desc(), Transaction.created_at.desc(), Transaction.id.desc())
            .limit(RECENT_COUNT)
            .options(
                joinedload(Transaction.account),
                joinedload(Transaction.card),
                joinedload(Transaction.category),
                joinedload(Transaction.person),
                selectinload(Transaction.shares).joinedload(ExpenseShare.person),
            )
        ).unique()
    )
    others = queries.counterparts(session, rows)
    return [TransactionItem.model_validate(queries.to_item(r, others.get(r.id))) for r in rows]


def summary(session: Session, today: date) -> DashboardSummary:
    cards = list(session.scalars(select(CreditCard).where(CreditCard.is_archived.is_(False))))  # round trip 1
    dues = _card_dues(session, cards, today)
    flows, week = _flows(session, today)
    return DashboardSummary(
        today=today,
        hero=next((due for state, due in dues if is_hero(state)), None),  # dues are sorted most urgent first
        stats=_stats(session, month_start(today)),
        money_insights=flows,
        week=week,
        card_dues=[due for _, due in dues],
        expenses=_expenses(session, today),
        recent=_recent(session),
    )

