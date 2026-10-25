"""Transfers, card payments and pair-aware edit/delete.

A transfer or card payment is two rows sharing a `link_id`. Both are added to the same
session and the route commits once, so they are written in one DB transaction:
either both exist or neither does. Editing or deleting either half changes both.

Functions flush but never commit — the route owns the transaction.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import start_of_day_ist
from app.models import BankAccount, CreditCard, ExpenseShare, Transaction, TransactionKind
from app.services.errors import ArchivedError, InvalidInputError, NotFoundError

if TYPE_CHECKING:
    from app.schemas.people import ShareIn
    from app.schemas.transactions import SimpleCreate, TransactionUpdate

# Note: app.services.people / categories are imported *inside* the functions below.
# people.py imports this module at the top, so a top-level import back would be circular
# (a Python import runs the module immediately, unlike Java's compile-time resolution).

CENT = Decimal("0.01")


# ---- Shared helpers ----------------------------------------------------------------------


def entry_time(occurred_on: date | None, today: date) -> datetime:
    """A date-only entry is stored as midnight IST, converted to UTC (we always store UTC)."""
    day = occurred_on or today
    if day > today:
        raise InvalidInputError("The date can't be in the future")
    return start_of_day_ist(day).astimezone(UTC)


def active_account(session: Session, account_id: uuid.UUID) -> BankAccount:
    account = session.get(BankAccount, account_id)
    if account is None:
        raise NotFoundError(f"Account {account_id} not found")
    if account.is_archived:
        raise ArchivedError(f"{account.nickname} is archived")
    return account


def active_card(session: Session, card_id: uuid.UUID) -> CreditCard:
    card = session.get(CreditCard, card_id)
    if card is None:
        raise NotFoundError(f"Card {card_id} not found")
    if card.is_archived:
        raise ArchivedError(f"{card.card_name} is archived")
    return card


def _positive(amount: Decimal) -> Decimal:
    if amount <= 0:
        raise InvalidInputError("Amount must be positive")
    return amount


# ---- Creating pairs ---------------------------------------------------------------------


def create_transfer(
    session: Session,
    *,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    amount: Decimal,
    occurred_on: date | None,
    today: date,
    description: str | None = None,
    tags: Sequence[str] = (),
) -> tuple[Transaction, Transaction]:
    """Move money between two of your accounts: −amount on `from`, +amount on `to`."""
    if from_account_id == to_account_id:
        raise InvalidInputError("Pick two different accounts")
    amount = _positive(amount)
    source, target = active_account(session, from_account_id), active_account(session, to_account_id)
    return _pair(
        session,
        TransactionKind.TRANSFER,
        debit={"account": source},
        credit={"account": target},
        amount=amount,
        occurred_at=entry_time(occurred_on, today),
        description=description,
        tags=tags,
    )


def create_card_payment(
    session: Session,
    *,
    from_account_id: uuid.UUID,
    card_id: uuid.UUID,
    amount: Decimal,
    occurred_on: date | None,
    today: date,
    description: str | None = None,
    tags: Sequence[str] = (),
) -> tuple[Transaction, Transaction]:
    """Pay a card bill: −amount on the bank account, +amount on the card (reduces what you owe)."""
    amount = _positive(amount)
    account, card = active_account(session, from_account_id), active_card(session, card_id)
    return _pair(
        session,
        TransactionKind.CARD_PAYMENT,
        debit={"account": account},
        credit={"card": card},
        amount=amount,
        occurred_at=entry_time(occurred_on, today),
        description=description,
        tags=tags,
    )


def _pair(
    session: Session,
    kind: TransactionKind,
    *,
    debit: dict[str, object],
    credit: dict[str, object],
    amount: Decimal,
    occurred_at: datetime,
    description: str | None,
    tags: Sequence[str],
) -> tuple[Transaction, Transaction]:
    link_id = uuid.uuid4()
    common = {"kind": kind, "link_id": link_id, "occurred_at": occurred_at, "description": description, "tags": list(tags)}
    out = Transaction(amount=-amount, **common, **debit)
    into = Transaction(amount=amount, **common, **credit)
    session.add_all([out, into])
    session.flush()  # both rows in the same DB transaction; the route commits once
    return out, into


# ---- Reading / changing pairs -----------------------------------------------------------


def get_transaction(session: Session, transaction_id: uuid.UUID) -> Transaction:
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise NotFoundError(f"Transaction {transaction_id} not found")
    return transaction


def counterpart(session: Session, transaction: Transaction) -> Transaction | None:
    """The other half of a transfer / card payment (None for ordinary transactions)."""
    if transaction.link_id is None:
        return None
    return session.scalar(
        select(Transaction).where(Transaction.link_id == transaction.link_id, Transaction.id != transaction.id)
    )


def linked_group(session: Session, transaction: Transaction) -> list[Transaction]:
    if transaction.link_id is None:
        return [transaction]
    return list(session.scalars(select(Transaction).where(Transaction.link_id == transaction.link_id)))


def update_pair(
    session: Session,
    transaction: Transaction,
    *,
    amount: Decimal | None = None,
    occurred_on: date | None = None,
    today: date,
    description: str | None = None,
    tags: Sequence[str] | None = None,
    set_description: bool = False,
) -> list[Transaction]:
    """Change amount/date/description/tags on a transfer or card payment — both halves together."""
    group = linked_group(session, transaction)
    if amount is not None:
        amount = _positive(amount)
    when = entry_time(occurred_on, today) if occurred_on is not None else None
    for row in group:
        if amount is not None:
            row.amount = -amount if row.amount < 0 else amount  # keep each side's sign
        if when is not None:
            row.occurred_at = when
        if set_description:
            row.description = description
        if tags is not None:
            row.tags = list(tags)
    session.flush()
    return group


def delete_transaction(session: Session, transaction_id: uuid.UUID) -> int:
    """Delete an entry; for a transfer/card payment both halves go. Shares cascade. Returns rows deleted."""
    group = linked_group(session, get_transaction(session, transaction_id))
    for row in group:
        session.delete(row)
    session.flush()
    return len(group)


# ---- Card outstanding -------------------------------------------------------------------


def card_outstanding(session: Session, card_ids: Sequence[uuid.UUID], as_of: datetime) -> dict[uuid.UUID, Decimal]:
    """What you owe on each card: −SUM(card transactions) up to `as_of`.
    Spending (negative) increases it; payments and refunds (positive) reduce it."""
    if not card_ids:
        return {}
    rows = session.execute(
        select(Transaction.card_id, func.sum(Transaction.amount))
        .where(Transaction.card_id.in_(card_ids), Transaction.occurred_at <= as_of)
        .group_by(Transaction.card_id)
    ).all()
    sums = {card_id: Decimal(total) for card_id, total in rows}
    result: dict[uuid.UUID, Decimal] = {}
    for cid in card_ids:
        owed = (-sums.get(cid, Decimal(0))).quantize(CENT)
        result[cid] = owed if owed != 0 else Decimal("0.00")  # avoid "-0.00" (Decimal keeps the sign of zero)
    return result


# ---- Simple expense / income ------------------------------------------------------------


def source_ref(txn: Transaction) -> dict[str, object]:
    """{"kind", "id", "name"} for the account or card a transaction belongs to."""
    if txn.account is not None:
        return {"kind": "account", "id": txn.account.id, "name": f"{txn.account.bank_name} · {txn.account.nickname}"}
    assert txn.card is not None  # exactly one source (DB CHECK)
    return {"kind": "card", "id": txn.card.id, "name": f"{txn.card.bank_name} · {txn.card.card_name}"}


def _set_source(session: Session, txn: Transaction, account_id: uuid.UUID | None, card_id: uuid.UUID | None) -> None:
    if account_id is not None:
        txn.account, txn.card = active_account(session, account_id), None
    else:
        assert card_id is not None
        txn.card, txn.account = active_card(session, card_id), None


def _replace_shares(session: Session, txn: Transaction, shares: Sequence["ShareIn"]) -> None:
    from app.services.people import get_person, require_active

    for share in shares:
        require_active(get_person(session, share.person_id))
    if txn.shares:
        # SQLAlchemy's unit of work flushes INSERTs before DELETEs, so re-adding the same person
        # would hit the (transaction, person) unique constraint. Delete the old split first.
        for old in list(txn.shares):
            session.delete(old)
        txn.shares.clear()
        session.flush()
    txn.shares = [ExpenseShare(person_id=s.person_id, amount=s.amount, note=s.note) for s in shares]


def _check_shares_fit(txn: Transaction, share_amounts: Sequence[Decimal]) -> None:
    from app.services.settlement_math import check_split

    if not share_amounts:
        return
    if txn.amount > 0:
        raise InvalidInputError("Only money you spent can be split")
    try:
        check_split(-txn.amount, list(share_amounts))
    except ValueError as exc:
        raise InvalidInputError(str(exc)) from exc


def create_simple(session: Session, data: "SimpleCreate", today: date) -> Transaction:
    from app.services.categories import usable_category
    from app.services.people import get_person, require_active

    kind = TransactionKind.EXPENSE if data.type == "expense" else TransactionKind.INCOME
    txn = Transaction(
        kind=kind,
        amount=-data.amount if data.is_debit else data.amount,
        occurred_at=entry_time(data.occurred_on, today),
        description=data.description,
        tags=list(data.tags),
    )
    # Pause autoflush while assembling: the lookups below would otherwise try to save a
    # half-built transaction (e.g. before its category or split is attached).
    with session.no_autoflush:
        _set_source(session, txn, data.source.account_id, data.source.card_id)
        if data.category_id is not None:
            txn.category = usable_category(session, data.category_id)
        if data.person_id is not None:
            person = get_person(session, data.person_id)
            require_active(person)
            txn.person = person
        _check_shares_fit(txn, [s.amount for s in data.shares])
        _replace_shares(session, txn, data.shares)
    session.add(txn)
    session.flush()
    return txn


# ---- Editing (rules depend on the kind) ---------------------------------------------------

_LOCKED_KINDS = {TransactionKind.SETTLEMENT, TransactionKind.ADJUSTMENT}


def update_transaction(session: Session, txn: Transaction, data: "TransactionUpdate", today: date) -> list[Transaction]:
    """Apply a PATCH. Returns every row that changed (both halves for a transfer / card payment)."""
    from app.services.categories import usable_category

    sent = data.model_fields_set

    if txn.kind in _LOCKED_KINDS:
        locked = sent - {"description", "tags"}
        if locked:
            raise InvalidInputError(
                f"Only the note and tags of a {txn.kind.value} can be edited — delete it and record it again instead"
            )
    if txn.kind.is_paired:
        unsupported = sent - {"amount", "occurred_on", "description", "tags"}
        if unsupported:
            raise InvalidInputError(f"Can't change {', '.join(sorted(unsupported))} on a {txn.kind.value.replace('_', ' ')}")
        return update_pair(
            session, txn, amount=data.amount, occurred_on=data.occurred_on, today=today,
            description=data.description, set_description="description" in sent, tags=data.tags,
        )

    if "source" in sent and data.source is not None:
        _set_source(session, txn, data.source.account_id, data.source.card_id)
    if "amount" in sent or "direction" in sent:
        magnitude = data.amount if data.amount is not None else abs(txn.amount)
        debit = (data.direction == "debit") if data.direction is not None else txn.amount < 0
        txn.amount = -magnitude if debit else magnitude
    if data.occurred_on is not None:
        txn.occurred_at = entry_time(data.occurred_on, today)
    if "description" in sent:
        txn.description = data.description
    if data.tags is not None:
        txn.tags = list(data.tags)
    if "category_id" in sent:
        txn.category = usable_category(session, data.category_id) if data.category_id else None
    if data.shares is not None:
        _check_shares_fit(txn, [s.amount for s in data.shares])
        _replace_shares(session, txn, data.shares)
    else:
        _check_shares_fit(txn, [s.amount for s in txn.shares])  # a smaller amount must still cover the split
    session.flush()
    return [txn]
