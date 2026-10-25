"""Reading transactions: filters, search, cursor paging, summary, and response building.

Cursor ("keyset") paging: each page asks for rows strictly *after* the last row it saw,
ordered newest first by (occurred_at, created_at, id). Unlike OFFSET, it never skips or
repeats rows when new transactions are added while you scroll.
"""

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Select, and_, case, func, or_, select, tuple_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.time import start_of_day_ist
from app.models import ExpenseShare, Transaction, TransactionKind
from app.services.errors import InvalidInputError
from app.services.transactions import source_ref

ZERO = Decimal("0.00")
PAIRED_KINDS = [TransactionKind.TRANSFER, TransactionKind.CARD_PAYMENT]


@dataclass(frozen=True)
class TransactionFilter:
    date_from: date | None = None  # inclusive, IST day
    date_to: date | None = None  # inclusive, IST day
    account_id: uuid.UUID | None = None
    card_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    person_id: uuid.UUID | None = None
    kind: TransactionKind | None = None
    q: str | None = None


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _apply_filters(stmt: Select, f: TransactionFilter) -> Select:  # type: ignore[type-arg]
    conditions = []
    if f.date_from:
        conditions.append(Transaction.occurred_at >= start_of_day_ist(f.date_from))
    if f.date_to:
        conditions.append(Transaction.occurred_at < start_of_day_ist(f.date_to + timedelta(days=1)))
    if f.account_id:
        conditions.append(Transaction.account_id == f.account_id)
    if f.card_id:
        conditions.append(Transaction.card_id == f.card_id)
    if f.category_id:
        conditions.append(Transaction.category_id == f.category_id)
    if f.kind:
        conditions.append(Transaction.kind == f.kind)
    if f.person_id:
        # Money from them, or an expense they owe part of.
        shared = select(ExpenseShare.transaction_id).where(ExpenseShare.person_id == f.person_id)
        conditions.append(or_(Transaction.person_id == f.person_id, Transaction.id.in_(shared)))
    if f.q and f.q.strip():
        pattern = f"%{_escape_like(f.q.strip())}%"
        conditions.append(
            or_(
                Transaction.description.ilike(pattern, escape="\\"),
                # any tag containing the text (tags are stored lower-case)
                func.array_to_string(Transaction.tags, " ").ilike(pattern, escape="\\"),
            )
        )
    return stmt.where(and_(*conditions)) if conditions else stmt


# ---- Cursor ----------------------------------------------------------------------------


def encode_cursor(txn: Transaction) -> str:
    raw = f"{txn.occurred_at.isoformat()}|{txn.created_at.isoformat()}|{txn.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        occurred, created, txn_id = base64.urlsafe_b64decode(padded).decode().split("|")
        return datetime.fromisoformat(occurred), datetime.fromisoformat(created), uuid.UUID(txn_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise InvalidInputError("Invalid cursor") from exc


# ---- Queries -----------------------------------------------------------------------------


def list_page(session: Session, f: TransactionFilter, *, cursor: str | None, limit: int) -> tuple[list[Transaction], str | None]:
    order = (Transaction.occurred_at.desc(), Transaction.created_at.desc(), Transaction.id.desc())
    stmt = _apply_filters(select(Transaction), f).order_by(*order)
    if cursor:
        occurred, created, txn_id = decode_cursor(cursor)
        # Row-value comparison: "everything that sorts after the cursor row".
        stmt = stmt.where(tuple_(Transaction.occurred_at, Transaction.created_at, Transaction.id) < (occurred, created, txn_id))
    stmt = stmt.limit(limit + 1).options(  # one extra row tells us whether there's a next page
        joinedload(Transaction.account),
        joinedload(Transaction.card),
        joinedload(Transaction.category),
        joinedload(Transaction.person),
        selectinload(Transaction.shares).joinedload(ExpenseShare.person),
    )
    rows = list(session.scalars(stmt).unique())
    has_more = len(rows) > limit
    rows = rows[:limit]
    return rows, (encode_cursor(rows[-1]) if has_more and rows else None)


def summarize(session: Session, f: TransactionFilter) -> dict[str, object]:
    """Count / money in / money out over the whole filter — excluding transfers & card payments
    (your own money moving between your accounts isn't income or spending)."""
    stmt = _apply_filters(
        select(
            func.count(),
            func.coalesce(func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)), 0),
            func.coalesce(func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0)), 0),
        ).where(Transaction.kind.not_in(PAIRED_KINDS)),
        f,
    )
    count, money_in, money_out = session.execute(stmt).one()
    return {"count": count, "money_in": Decimal(money_in).quantize(Decimal("0.01")), "money_out": Decimal(money_out).quantize(Decimal("0.01"))}


def counterparts(session: Session, rows: list[Transaction]) -> dict[uuid.UUID, Transaction]:
    """For each paired row on the page, the other half — in one query."""
    link_ids = {r.link_id for r in rows if r.link_id is not None}
    if not link_ids:
        return {}
    others = session.scalars(
        select(Transaction)
        .options(joinedload(Transaction.account), joinedload(Transaction.card))
        .where(Transaction.link_id.in_(link_ids))
    ).unique()
    by_link: dict[uuid.UUID, list[Transaction]] = {}
    for other in others:
        by_link.setdefault(other.link_id, []).append(other)  # type: ignore[arg-type]
    result: dict[uuid.UUID, Transaction] = {}
    for row in rows:
        if row.link_id is not None:
            match = next((o for o in by_link.get(row.link_id, []) if o.id != row.id), None)
            if match is not None:
                result[row.id] = match
    return result


def to_item(txn: Transaction, other: Transaction | None) -> dict[str, object]:
    return {
        "id": txn.id,
        "type": txn.kind.value,
        "direction": txn.direction,
        "amount": txn.amount,
        "occurred_at": txn.occurred_at,
        "description": txn.description,
        "tags": list(txn.tags or []),
        "source": source_ref(txn),
        "counterpart": source_ref(other) if other is not None else None,
        "category": (
            {"id": txn.category.id, "name": txn.category.name, "icon": txn.category.icon, "color": txn.category.color}
            if txn.category
            else None
        ),
        "person": {"id": txn.person.id, "name": txn.person.name} if txn.person else None,
        "shares": [{"person_id": s.person_id, "person_name": s.person.name, "amount": s.amount} for s in txn.shares],
        "link_id": txn.link_id,
        "created_at": txn.created_at,
        "updated_at": txn.updated_at,
    }


def load_items(session: Session, ids: list[uuid.UUID]) -> list[dict[str, object]]:
    """Fresh, fully-loaded response items for specific transactions (after create/update)."""
    rows = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.id.in_(ids))
            .options(
                joinedload(Transaction.account),
                joinedload(Transaction.card),
                joinedload(Transaction.category),
                joinedload(Transaction.person),
                selectinload(Transaction.shares).joinedload(ExpenseShare.person),
            )
            .order_by(Transaction.amount)  # debit side first for pairs
        ).unique()
    )
    others = counterparts(session, rows)
    return [to_item(r, others.get(r.id)) for r in rows]
