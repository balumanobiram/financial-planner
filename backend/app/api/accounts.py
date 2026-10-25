import uuid
from decimal import Decimal

from fastapi import APIRouter, status

from app.api.deps import DbSession, Now
from app.models import BankAccount
from app.schemas.bank_account import (
    AdjustmentRead,
    BankAccountCreate,
    BankAccountList,
    BankAccountRead,
    BankAccountUpdate,
    ReconcileRequest,
    ReconcileResponse,
)
from app.services import accounts as service
from app.services.balances import account_balance, account_balances, reconcile

router = APIRouter(prefix="/accounts", tags=["accounts"])

_ORM_FIELDS = [name for name in BankAccountRead.model_fields if name != "current_balance"]


def _to_read(account: BankAccount, balance: Decimal) -> BankAccountRead:
    return BankAccountRead.model_validate(
        {**{name: getattr(account, name) for name in _ORM_FIELDS}, "current_balance": balance}
    )


@router.get("")
def list_accounts(db: DbSession, now: Now, include_archived: bool = False) -> BankAccountList:
    accounts = service.list_accounts(db, include_archived=include_archived)
    balances = account_balances(db, accounts, now)
    total = sum((balances[a.id] for a in accounts if not a.is_archived), Decimal("0.00"))
    return BankAccountList(items=[_to_read(a, balances[a.id]) for a in accounts], total_balance=total)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_account(body: BankAccountCreate, db: DbSession, now: Now) -> BankAccountRead:
    account = service.create_account(db, body)
    db.commit()
    return _to_read(account, account_balance(db, account, now))


@router.get("/{account_id}")
def get_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.get_account(db, account_id)
    return _to_read(account, account_balance(db, account, now))


@router.patch("/{account_id}")
def update_account(account_id: uuid.UUID, body: BankAccountUpdate, db: DbSession, now: Now) -> BankAccountRead:
    account = service.update_account(db, service.get_account(db, account_id), body)
    db.commit()
    return _to_read(account, account_balance(db, account, now))


@router.post("/{account_id}/archive")
def archive_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.set_archived(db, service.get_account(db, account_id), archived=True)
    db.commit()
    return _to_read(account, account_balance(db, account, now))


@router.post("/{account_id}/unarchive")
def unarchive_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.set_archived(db, service.get_account(db, account_id), archived=False)
    db.commit()
    return _to_read(account, account_balance(db, account, now))


@router.post("/{account_id}/reconcile")
def reconcile_account(account_id: uuid.UUID, body: ReconcileRequest, db: DbSession, now: Now) -> ReconcileResponse:
    """Enter the real balance from your bank app; an adjustment transaction covers the difference."""
    account = service.get_account(db, account_id)
    adjustment = reconcile(db, account, body.actual_balance, now)
    db.commit()
    return ReconcileResponse(
        account=_to_read(account, account_balance(db, account, now)),
        adjustment=AdjustmentRead.model_validate(adjustment) if adjustment else None,
    )
