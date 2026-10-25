import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import DbSession, Today
from app.models import TransactionKind
from app.schemas.transactions import (
    CardPaymentCreate,
    CreatedTransactions,
    SimpleCreate,
    TransactionCreate,
    TransactionItem,
    TransactionPage,
    TransactionSummary,
    TransactionUpdate,
    TransferCreate,
)
from app.services import transaction_queries as queries
from app.services import transactions as service
from app.services.errors import InvalidInputError

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("")
def list_transactions(
    db: DbSession,
    date_from: Annotated[date | None, Query(alias="from", description="Inclusive, IST day")] = None,
    date_to: Annotated[date | None, Query(alias="to", description="Inclusive, IST day")] = None,
    account_id: uuid.UUID | None = None,
    card_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    person_id: uuid.UUID | None = None,
    type: TransactionKind | None = None,  # noqa: A002 — matches the API field name
    q: Annotated[str | None, Query(max_length=100, description="Search description and tags")] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> TransactionPage:
    """Newest first. Pass `next_cursor` back as `cursor` for the next page (infinite scroll)."""
    if date_from and date_to and date_from > date_to:
        raise InvalidInputError("'from' must be on or before 'to'")
    f = queries.TransactionFilter(
        date_from=date_from, date_to=date_to, account_id=account_id, card_id=card_id,
        category_id=category_id, person_id=person_id, kind=type, q=q,
    )
    rows, next_cursor = queries.list_page(db, f, cursor=cursor, limit=limit)
    others = queries.counterparts(db, rows)
    return TransactionPage(
        items=[TransactionItem.model_validate(queries.to_item(r, others.get(r.id))) for r in rows],
        next_cursor=next_cursor,
        summary=None if cursor else TransactionSummary.model_validate(queries.summarize(db, f)),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_transaction(body: TransactionCreate, db: DbSession, today: Today) -> CreatedTransactions:
    """Expense / income (optionally split), transfer, or card payment — one endpoint, chosen by `type`."""
    common = {"amount": body.amount, "occurred_on": body.occurred_on, "today": today,
              "description": body.description, "tags": body.tags}
    if isinstance(body, SimpleCreate):
        ids = [service.create_simple(db, body, today).id]
    elif isinstance(body, TransferCreate):
        ids = [t.id for t in service.create_transfer(db, from_account_id=body.from_account_id, to_account_id=body.to_account_id, **common)]
    else:
        assert isinstance(body, CardPaymentCreate)
        ids = [t.id for t in service.create_card_payment(db, from_account_id=body.from_account_id, card_id=body.card_id, **common)]
    db.commit()
    return CreatedTransactions(items=[TransactionItem.model_validate(i) for i in queries.load_items(db, ids)])


@router.get("/{transaction_id}")
def get_transaction(transaction_id: uuid.UUID, db: DbSession) -> TransactionItem:
    service.get_transaction(db, transaction_id)  # 404 if missing
    return TransactionItem.model_validate(queries.load_items(db, [transaction_id])[0])


@router.patch("/{transaction_id}")
def update_transaction(transaction_id: uuid.UUID, body: TransactionUpdate, db: DbSession, today: Today) -> CreatedTransactions:
    """Edit. For a transfer / card payment both halves change; returns every changed row."""
    changed = service.update_transaction(db, service.get_transaction(db, transaction_id), body, today)
    db.commit()
    ids = [t.id for t in changed]
    return CreatedTransactions(items=[TransactionItem.model_validate(i) for i in queries.load_items(db, ids)])


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: uuid.UUID, db: DbSession) -> None:
    """Remove an entry (and any split of it); for a transfer or card payment, both halves."""
    service.delete_transaction(db, transaction_id)
    db.commit()
