import uuid

from fastapi import APIRouter, status
from sqlalchemy.orm import Session

from app.api.deps import DbSession, Today
from app.models import Person, Transaction
from app.schemas.people import (
    HistoryEntry,
    PaymentIn,
    PeopleList,
    PersonCreate,
    PersonDetail,
    PersonRead,
    PersonTotalsRead,
    PersonUpdate,
    SharedExpenseIn,
    TransactionRead,
)
from app.services import people as service
from app.services.settlement_math import ZERO, PersonTotals

router = APIRouter(tags=["people"])

_ORM_FIELDS = [name for name in PersonRead.model_fields if name != "totals"]


def _totals(t: PersonTotals) -> PersonTotalsRead:
    return PersonTotalsRead(
        shared_total=t.shared_total, settled_total=t.settled_total, outstanding=t.outstanding, received_total=t.received_total
    )


def _to_read(person: Person, totals: PersonTotals) -> PersonRead:
    return PersonRead.model_validate({**{n: getattr(person, n) for n in _ORM_FIELDS}, "totals": _totals(totals)})


def _read_one(db: Session, person: Person) -> PersonRead:
    return _to_read(person, service.totals_for(db, [person.id])[person.id])


def _txn_read(txn: Transaction) -> TransactionRead:
    return TransactionRead.model_validate(
        {n: getattr(txn, n) for n in TransactionRead.model_fields} | {"kind": txn.kind.value}
    )


# ---- People --------------------------------------------------------------------------


@router.get("/people")
def list_people(db: DbSession, include_archived: bool = False) -> PeopleList:
    people = service.list_people(db, include_archived=include_archived)
    totals = service.totals_for(db, [p.id for p in people])
    items = [_to_read(p, totals[p.id]) for p in people]
    # Active first, most owed first; archived last.
    items.sort(key=lambda p: (p.is_archived, -p.totals.outstanding, p.name.lower()))
    total = sum((p.totals.outstanding for p in items if not p.is_archived and p.totals.outstanding > 0), ZERO)
    return PeopleList(items=items, total_outstanding=total)


@router.post("/people", status_code=status.HTTP_201_CREATED)
def create_person(body: PersonCreate, db: DbSession) -> PersonRead:
    person = service.create_person(db, body)
    db.commit()
    return _read_one(db, person)


@router.get("/people/{person_id}")
def get_person(person_id: uuid.UUID, db: DbSession) -> PersonDetail:
    person = service.get_person(db, person_id)
    read = _read_one(db, person)
    history = [HistoryEntry.model_validate(e) for e in service.history(db, person)]
    return PersonDetail(**read.model_dump(), history=history)


@router.patch("/people/{person_id}")
def update_person(person_id: uuid.UUID, body: PersonUpdate, db: DbSession) -> PersonRead:
    person = service.update_person(db, service.get_person(db, person_id), body)
    db.commit()
    return _read_one(db, person)


@router.post("/people/{person_id}/archive")
def archive_person(person_id: uuid.UUID, db: DbSession) -> PersonRead:
    person = service.set_archived(db, service.get_person(db, person_id), archived=True)
    db.commit()
    return _read_one(db, person)


@router.post("/people/{person_id}/unarchive")
def unarchive_person(person_id: uuid.UUID, db: DbSession) -> PersonRead:
    person = service.set_archived(db, service.get_person(db, person_id), archived=False)
    db.commit()
    return _read_one(db, person)


# ---- Money flows ----------------------------------------------------------------------


@router.post("/people/{person_id}/income", status_code=status.HTTP_201_CREATED)
def record_income(person_id: uuid.UUID, body: PaymentIn, db: DbSession, today: Today) -> TransactionRead:
    """Money from this person that isn't repayment (e.g. dad sends ₹5,000) → income into a bank account."""
    txn = service.record_income(db, service.get_person(db, person_id), body, today)
    db.commit()
    return _txn_read(txn)


@router.post("/people/{person_id}/settlements", status_code=status.HTTP_201_CREATED)
def record_settlement(person_id: uuid.UUID, body: PaymentIn, db: DbSession, today: Today) -> TransactionRead:
    """They paid you back (partial is fine). Refused if it's more than they owe."""
    txn = service.record_settlement(db, service.get_person(db, person_id), body, today)
    db.commit()
    return _txn_read(txn)


@router.post("/shared-expenses", status_code=status.HTTP_201_CREATED)
def create_shared_expense(body: SharedExpenseIn, db: DbSession, today: Today) -> TransactionRead:
    """Record a card or bank spend and who owes you how much of it."""
    txn = service.create_shared_expense(db, body, today)
    db.commit()
    return _txn_read(txn)
