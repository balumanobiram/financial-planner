"""People, money from people, shared expenses and settlements.

Functions flush but never commit — the route owns the transaction.
"""

import uuid
from collections.abc import Sequence
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import ExpenseShare, Person, Transaction, TransactionKind
from app.schemas.people import PaymentIn, PersonCreate, PersonUpdate, SharedExpenseIn
from app.services.errors import ArchivedError, InvalidInputError, NotFoundError
from app.services.settlement_math import ZERO, PersonTotals, allocate_settlements, check_settlement, check_split
from app.services.transactions import active_account, active_card, entry_time, source_ref

CENT = Decimal("0.01")


# ---- People CRUD -----------------------------------------------------------------


def list_people(session: Session, *, include_archived: bool = False) -> list[Person]:
    stmt = select(Person).order_by(Person.name)
    if not include_archived:
        stmt = stmt.where(Person.is_archived.is_(False))
    return list(session.scalars(stmt))


def get_person(session: Session, person_id: uuid.UUID) -> Person:
    person = session.get(Person, person_id)
    if person is None:
        raise NotFoundError(f"Person {person_id} not found")
    return person


def create_person(session: Session, data: PersonCreate) -> Person:
    person = Person(**data.model_dump())
    session.add(person)
    session.flush()
    return person


def update_person(session: Session, person: Person, data: PersonUpdate) -> Person:
    require_active(person)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    session.flush()
    return person


def set_archived(session: Session, person: Person, *, archived: bool) -> Person:
    person.is_archived = archived
    session.flush()
    return person


# ---- Totals (computed, never stored) ------------------------------------------------


def totals_for(session: Session, person_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, PersonTotals]:
    """Shared / settled / received for many people in two grouped queries (no N+1)."""
    if not person_ids:
        return {}
    shared = dict(
        session.execute(
            select(ExpenseShare.person_id, func.sum(ExpenseShare.amount))
            .where(ExpenseShare.person_id.in_(person_ids))
            .group_by(ExpenseShare.person_id)
        ).all()
    )
    by_kind: dict[tuple[uuid.UUID, TransactionKind], Decimal] = {
        (pid, kind): total
        for pid, kind, total in session.execute(
            select(Transaction.person_id, Transaction.kind, func.sum(Transaction.amount))
            .where(
                Transaction.person_id.in_(person_ids),
                Transaction.kind.in_([TransactionKind.SETTLEMENT, TransactionKind.INCOME]),
            )
            .group_by(Transaction.person_id, Transaction.kind)
        ).all()
    }

    def money(value: Decimal | None) -> Decimal:
        return (value or ZERO).quantize(CENT)

    return {
        pid: PersonTotals(
            shared_total=money(shared.get(pid)),
            settled_total=money(by_kind.get((pid, TransactionKind.SETTLEMENT))),
            received_total=money(by_kind.get((pid, TransactionKind.INCOME))),
        )
        for pid in person_ids
    }


# ---- Money flows ----------------------------------------------------------------------


def record_income(session: Session, person: Person, data: PaymentIn, today: date) -> Transaction:
    """(a) Money from a person that isn't repayment, e.g. dad sends ₹5,000."""
    return _payment(session, person, data, today, TransactionKind.INCOME)


def record_settlement(session: Session, person: Person, data: PaymentIn, today: date) -> Transaction:
    """(c) A person paying back (part of) what they owe."""
    outstanding = totals_for(session, [person.id])[person.id].outstanding
    try:
        check_settlement(outstanding, data.amount)
    except ValueError as exc:
        raise InvalidInputError(str(exc)) from exc
    return _payment(session, person, data, today, TransactionKind.SETTLEMENT)


def create_shared_expense(session: Session, data: SharedExpenseIn, today: date) -> Transaction:
    """(b) Something you paid for that others owe you part (or all) of."""
    try:
        check_split(data.amount, [s.amount for s in data.shares])
    except ValueError as exc:
        raise InvalidInputError(str(exc)) from exc
    for share in data.shares:
        require_active(get_person(session, share.person_id))

    transaction = Transaction(
        kind=TransactionKind.EXPENSE,
        amount=-data.amount,  # money out
        occurred_at=entry_time(data.occurred_on, today),
        description=data.description,
    )
    if data.account_id:
        transaction.account = active_account(session, data.account_id)
    else:
        assert data.card_id is not None  # guaranteed by SharedExpenseIn
        transaction.card = active_card(session, data.card_id)
    transaction.shares = [ExpenseShare(person_id=s.person_id, amount=s.amount, note=s.note) for s in data.shares]
    session.add(transaction)
    session.flush()
    return transaction


# ---- History ------------------------------------------------------------------------


def history(session: Session, person: Person) -> list[dict[str, object]]:
    """Everything involving this person, newest first. Shared expenses carry Paid/Part paid/Open."""
    share_rows = session.execute(
        select(ExpenseShare, Transaction)
        .join(Transaction, ExpenseShare.transaction_id == Transaction.id)
        .options(joinedload(Transaction.account), joinedload(Transaction.card))
        .where(ExpenseShare.person_id == person.id)
        .order_by(Transaction.occurred_at, ExpenseShare.created_at)  # oldest first, for allocation
    ).all()
    payments = session.scalars(
        select(Transaction)
        .options(joinedload(Transaction.account))
        .where(
            Transaction.person_id == person.id,
            Transaction.kind.in_([TransactionKind.SETTLEMENT, TransactionKind.INCOME]),
        )
    ).all()

    settled_total = sum((p.amount for p in payments if p.kind is TransactionKind.SETTLEMENT), ZERO)
    allocation = allocate_settlements([(share.id, share.amount) for share, _ in share_rows], settled_total)

    entries: list[dict[str, object]] = []
    for (share, txn), alloc in zip(share_rows, allocation, strict=True):
        entries.append(
            {
                "type": "shared_expense",
                "transaction_id": txn.id,
                "occurred_at": txn.occurred_at,
                "description": txn.description,
                "amount": share.amount,
                "source": source_ref(txn),
                "total_spent": -txn.amount,
                "status": alloc.status.value,
                "remaining": alloc.remaining,
                "_sort": share.created_at,
            }
        )
    for payment in payments:
        entries.append(
            {
                "type": payment.kind.value,
                "transaction_id": payment.id,
                "occurred_at": payment.occurred_at,
                "description": payment.description,
                "amount": payment.amount,
                "source": source_ref(payment),
                "_sort": payment.created_at,
            }
        )
    entries.sort(key=lambda e: (e["occurred_at"], e["_sort"]), reverse=True)  # type: ignore[arg-type, return-value]
    for entry in entries:
        del entry["_sort"]
    return entries


# ---- Helpers ------------------------------------------------------------------------


def _payment(session: Session, person: Person, data: PaymentIn, today: date, kind: TransactionKind) -> Transaction:
    require_active(person)
    transaction = Transaction(
        kind=kind,
        amount=data.amount,  # money in
        account=active_account(session, data.account_id),
        person=person,
        occurred_at=entry_time(data.occurred_on, today),
        description=data.description,
    )
    session.add(transaction)
    session.flush()
    return transaction


def require_active(person: Person) -> None:
    if person.is_archived:
        raise ArchivedError(f"{person.name} is archived — unarchive them first")
